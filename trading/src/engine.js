// The trading engine: scans markets, produces signals, enforces stops and
// (optionally) trades automatically. Manual orders from the dashboard also
// go through here so they get the same sizing, logging and stop tracking.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { analyze, computeSeries, evaluateAt, MIN_CANDLES } = require('./strategy');
const ind = require('./indicators');
const { optionIdea } = require('./options');
const { sizeBuy, DailyLossGuard } = require('./risk');
const { timeframeMs } = require('./marketData');

const MAX_TRADES = 500;
const MAX_ALERTS = 100;

class TradingEngine extends EventEmitter {
  constructor(config, { marketData, broker, notifier }) {
    super();
    this.config = config;
    this.marketData = marketData;
    this.broker = broker;
    this.notifier = notifier;
    this.autoTrade = config.autoTrade;
    this.signals = {};
    this.candles = {};
    this.prices = {};
    this.priceAt = {};
    this.liveScoredAt = {};
    this.exiting = new Set();
    this.balances = null;
    this.priceFeed = { mode: 'starting', message: '' };
    this.errors = {};
    this.alerts = [];
    this.lastActedCandle = {};
    this.lossGuard = new DailyLossGuard(config.risk.dailyLossLimitPct);
    this.guardState = { halted: false, drawdownPct: 0 };
    this.lastScanAt = null;
    this.scanning = false;
    this.orderQueue = Promise.resolve();

    this.positionsFile = path.join(config.dataDir, `${broker.mode}-positions.json`);
    this.tradesFile = path.join(config.dataDir, `${broker.mode}-trades.json`);
    this.positions = readJson(this.positionsFile, {});
    this.trades = readJson(this.tradesFile, []);
    // Open shorts: { symbol: { entryPrice, stopLoss, takeProfit, trailAtrMult, lowest, openedAt } }
    this.shortsFile = path.join(config.dataDir, `${broker.mode}-shorts.json`);
    this.shorts = readJson(this.shortsFile, {});
    this.allowShort = Boolean(config.strategy.allowShort && broker.supportsShort);
    this.shortBlockedReason =
      config.strategy.allowShort && !broker.supportsShort
        ? 'ALLOW_SHORT is ignored in live mode: Binance.US spot accounts cannot short. Shorting works in paper mode only.'
        : null;
    // Last signal per coin, saved so a restart doesn't re-alert the same signal.
    this.signalStateFile = path.join(config.dataDir, 'signal-state.json');
    this.lastSignal = readJson(this.signalStateFile, {});
  }

  // ---------------------------------------------------------------- scanning

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await Promise.all(this.config.symbols.map((s) => this.scanSymbol(s)));
      const portfolio = await this.getPortfolio({ fresh: true });
      this.guardState = this.lossGuard.update(portfolio.equity);
      for (const symbol of this.config.symbols) {
        if (!this.signals[symbol]) continue;
        await this.manageSymbol(symbol);
      }
      this.lastScanAt = Date.now();
      this.emit('scan');
    } catch (err) {
      this.addAlert('error', `Scan failed: ${err.message}`);
    } finally {
      this.scanning = false;
    }
  }

  async scanSymbol(symbol) {
    try {
      const candles = await this.marketData.fetchCandles(symbol, this.config.timeframe, this.config.candleLimit);
      // Only judge fully closed candles; the latest one is still forming.
      const tf = timeframeMs(this.config.timeframe);
      const closed = candles[candles.length - 1][0] + tf > Date.now() ? candles.slice(0, -1) : candles;
      const signal = analyze(closed, this.config.strategy);
      // Prefer the streamed price; fall back to the candle if the feed is quiet.
      const lastClose = candles[candles.length - 1][4];
      const streamed = Date.now() - (this.priceAt[symbol] || 0) < 15000;
      const price = streamed ? this.prices[symbol] : lastClose;

      this.candles[symbol] = candles;
      if (!streamed) this.prices[symbol] = price;
      this.signals[symbol] = { symbol, ...signal, livePrice: price, updatedAt: Date.now() };
      this.updateLiveScore(symbol, true);
      delete this.errors[symbol];

      // Alert only when a coin's signal changes (e.g. HOLD -> SELL), not on
      // every candle that repeats the same signal.
      const changed = signal.signal !== this.lastSignal[symbol];
      if (changed) {
        this.lastSignal[symbol] = signal.signal;
        writeJson(this.signalStateFile, this.lastSignal);
      }
      if (changed && signal.signal !== 'HOLD') {
        const text = `${signal.signal} ${symbol} @ ${fmt(price)} (score ${signal.score}) - ${signal.reasons.slice(0, 3).join('; ')}`;
        this.addAlert(signal.signal === 'BUY' ? 'buy' : 'sell', text, true);
      }
    } catch (err) {
      this.errors[symbol] = err.message;
    }
  }

  // ------------------------------------------------------------- live prices

  onPrices(prices) {
    const now = Date.now();
    const tf = timeframeMs(this.config.timeframe);
    let candleClosed = false;
    for (const [symbol, price] of Object.entries(prices)) {
      if (!this.config.symbols.includes(symbol) || !(price > 0)) continue;
      this.prices[symbol] = price;
      this.priceAt[symbol] = now;

      const candles = this.candles[symbol];
      if (candles) {
        const forming = candles[candles.length - 1];
        if (now >= forming[0] + tf) {
          // A candle just closed: start a new one and re-analyze shortly.
          candles.push([Math.floor(now / tf) * tf, price, price, price, price, 0]);
          candles.shift();
          candleClosed = true;
        } else {
          forming[4] = price;
          forming[2] = Math.max(forming[2], price);
          forming[3] = Math.min(forming[3], price);
        }
      }
      if (this.signals[symbol]) {
        this.signals[symbol].livePrice = price;
        this.updateLiveScore(symbol);
      }
      this.trailStop(symbol, price);
      this.checkStops(symbol);
    }
    if (candleClosed) {
      // Give the exchange a moment to finalize the closed candle.
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => this.scan(), 3000);
    }
    this.emit('tick');
  }

  // A provisional score that includes the still-forming candle. It is shown
  // on the dashboard so you can watch a signal building, but trades only
  // ever act on closed candles.
  updateLiveScore(symbol, force = false) {
    const candles = this.candles[symbol];
    const signal = this.signals[symbol];
    if (!candles || !signal) return;
    if (!force && Date.now() - (this.liveScoredAt[symbol] || 0) < 1000) return;
    this.liveScoredAt[symbol] = Date.now();
    try {
      const live = analyze(candles, this.config.strategy);
      signal.live = { score: live.score, signal: live.signal };
    } catch {
      // Not enough history yet; keep the last value.
    }
  }

  holding(symbol) {
    const amount = this.balances?.holdings[symbol.split('/')[0]] || 0;
    const value = amount * (this.prices[symbol] || 0);
    return { amount, value, held: value >= this.config.risk.minOrderSize };
  }

  shortHolding(symbol) {
    const amount = this.balances?.shorts?.[symbol.split('/')[0]]?.amount || 0;
    const value = amount * (this.prices[symbol] || 0);
    return { amount, value, held: value >= this.config.risk.minOrderSize };
  }

  // Moves trailing stops towards profit, never back: up behind the highest
  // price for a long, down above the lowest price for a short.
  trailStop(symbol, price) {
    const atr = this.signals[symbol]?.indicators?.atr;
    if (!atr || !(price > 0)) return;
    const long = this.positions[symbol];
    if (long?.trailAtrMult) {
      long.highest = Math.max(long.highest || 0, price);
      const stop = long.highest - long.trailAtrMult * atr;
      if (stop > (long.stopLoss || 0)) {
        long.stopLoss = stop;
        writeJson(this.positionsFile, this.positions);
      }
    }
    const short = this.shorts[symbol];
    if (short?.trailAtrMult) {
      short.lowest = Math.min(short.lowest || Infinity, price);
      const stop = short.lowest + short.trailAtrMult * atr;
      if (!short.stopLoss || stop < short.stopLoss) {
        short.stopLoss = stop;
        writeJson(this.shortsFile, this.shorts);
      }
    }
  }

  // Protective exits run on every price update, regardless of auto-trade.
  checkStops(symbol) {
    return this.checkLongStops(symbol) || this.checkShortStops(symbol);
  }

  checkShortStops(symbol) {
    const meta = this.shorts[symbol];
    const price = this.prices[symbol];
    const key = `${symbol}:short`;
    if (!this.config.enforceStops || !meta || this.exiting.has(key) || !this.shortHolding(symbol).held) return null;
    let order = null;
    if (meta.stopLoss && price >= meta.stopLoss) {
      const label = meta.trailAtrMult ? 'trailing-stop' : 'stop-loss';
      order = { symbol, side: 'cover', percent: 100, source: label, reason: `Short ${meta.trailAtrMult ? 'trailing stop' : 'stop-loss'} hit at ${fmt(meta.stopLoss)}` };
    } else if (meta.takeProfit && price <= meta.takeProfit) {
      order = { symbol, side: 'cover', percent: 100, source: 'take-profit', reason: `Short take-profit hit at ${fmt(meta.takeProfit)}` };
    }
    if (!order) return null;
    this.exiting.add(key);
    return this.safeOrder(order).finally(() => this.exiting.delete(key));
  }

  checkLongStops(symbol) {
    const meta = this.positions[symbol];
    const price = this.prices[symbol];
    if (!this.config.enforceStops || !meta || this.exiting.has(symbol) || !this.holding(symbol).held) return null;
    let order = null;
    if (meta.stopLoss && price <= meta.stopLoss) {
      const label = meta.trailAtrMult ? 'trailing-stop' : 'stop-loss';
      order = { symbol, side: 'sell', percent: 100, source: label, reason: `${meta.trailAtrMult ? 'Trailing stop' : 'Stop-loss'} hit at ${fmt(meta.stopLoss)}` };
    } else if (meta.takeProfit && price >= meta.takeProfit) {
      order = { symbol, side: 'sell', percent: 100, source: 'take-profit', reason: `Take-profit hit at ${fmt(meta.takeProfit)}` };
    }
    if (!order) return null;
    this.exiting.add(symbol);
    return this.safeOrder(order).finally(() => this.exiting.delete(symbol));
  }

  async manageSymbol(symbol) {
    const signal = this.signals[symbol];

    this.trailStop(symbol, this.prices[symbol]);
    const exit = this.checkStops(symbol);
    if (exit) return exit;

    if (!this.autoTrade || this.lastActedCandle[symbol] === signal.time) return;
    const held = this.holding(symbol).held;
    const shorted = this.shortHolding(symbol).held;
    const why = `${signal.signal} signal (score ${signal.score})`;

    // BUY: cover any short, then buy. SELL: sell any long, then (if enabled
    // and allowed in this market) open a short. Same order as the backtester.
    if (signal.signal === 'BUY') {
      if (shorted) {
        this.lastActedCandle[symbol] = signal.time;
        await this.safeOrder({ symbol, side: 'cover', percent: 100, source: 'auto', reason: why });
      }
      if (!held && !this.guardState.halted) {
        this.lastActedCandle[symbol] = signal.time;
        await this.safeOrder({ symbol, side: 'buy', source: 'auto', reason: why });
      }
    } else if (signal.signal === 'SELL') {
      if (held) {
        this.lastActedCandle[symbol] = signal.time;
        await this.safeOrder({ symbol, side: 'sell', percent: 100, source: 'auto', reason: why });
      }
      if (this.allowShort && signal.canShort && !shorted && !this.guardState.halted) {
        this.lastActedCandle[symbol] = signal.time;
        await this.safeOrder({ symbol, side: 'short', source: 'auto', reason: why });
      }
    }
  }

  async safeOrder(order) {
    try {
      return await this.placeOrder(order);
    } catch (err) {
      this.addAlert('error', `${order.source} ${order.side} ${order.symbol} failed: ${err.message}`, true);
      return null;
    }
  }

  // ------------------------------------------------------------------ orders

  // side: 'buy' | 'sell'
  // buy:  quoteAmount (e.g. 250 USDT); omitted -> sized by the risk rules
  // sell: percent of the holding (default 100)
  placeOrder(order) {
    const run = this.orderQueue.then(() => this.executeOrder(order));
    this.orderQueue = run.catch(() => {});
    return run;
  }

  async executeOrder({ symbol, side, quoteAmount, percent = 100, source = 'manual', reason = '' }) {
    if (!this.config.symbols.includes(symbol)) throw new Error(`Unknown symbol ${symbol}`);
    const price = this.prices[symbol] || (await this.marketData.fetchPrice(symbol));
    const portfolio = await this.getPortfolio({ fresh: true });
    const position = portfolio.positions.find((p) => p.symbol === symbol && p.side === 'long');
    const shortPosition = portfolio.positions.find((p) => p.symbol === symbol && p.side === 'short');
    const signal = this.signals[symbol];
    let fill;

    if (side === 'buy') {
      if (this.guardState.halted) {
        throw new Error(`Daily loss limit (${this.config.risk.dailyLossLimitPct}%) reached - new buys paused until tomorrow (UTC)`);
      }
      let amount = Number(quoteAmount);
      if (!amount) {
        const sized = sizeBuy(
          { equity: portfolio.equity, cash: portfolio.cash, price, stopLoss: signal?.stopLoss, currentPositionValue: position?.value || 0 },
          this.config.risk
        );
        if (!sized.amount) throw new Error(sized.reason);
        amount = sized.amount;
      }
      if (amount < this.config.risk.minOrderSize) throw new Error(`Minimum order is ${this.config.risk.minOrderSize} ${this.config.quote}`);
      fill = await this.broker.buy(symbol, amount, price);

      const prev = this.positions[symbol];
      const prevAmount = prev?.amount || 0;
      const newAmount = prevAmount + fill.amount;
      this.positions[symbol] = {
        amount: newAmount,
        entryPrice: ((prev?.entryPrice || 0) * prevAmount + fill.price * fill.amount) / newAmount,
        stopLoss: signal?.stopLoss ?? prev?.stopLoss ?? null,
        takeProfit: signal ? signal.takeProfit : prev?.takeProfit ?? null,
        // Trend mode: the stop trails the highest price since entry.
        trailAtrMult: signal ? signal.trailAtrMult ?? null : prev?.trailAtrMult ?? null,
        highest: Math.max(prev?.highest || 0, fill.price),
        openedAt: prev?.openedAt || Date.now(),
      };
    } else if (side === 'sell') {
      if (!position || position.amount <= 0) throw new Error(`No ${symbol.split('/')[0]} to sell`);
      const pct = Math.min(Math.max(Number(percent) || 100, 0), 100);
      fill = await this.broker.sell(symbol, position.amount * (pct / 100), price);

      const meta = this.positions[symbol];
      if (meta?.entryPrice) fill.realizedPnl = (fill.price - meta.entryPrice) * fill.amount - fill.fee;
      if (pct >= 100) delete this.positions[symbol];
      else if (meta) meta.amount = Math.max(meta.amount - fill.amount, 0);
    } else if (side === 'short') {
      if (!this.allowShort) throw new Error(this.shortBlockedReason || 'Shorting is off. Set ALLOW_SHORT=true in .env to enable it (paper mode).');
      if (this.guardState.halted) {
        throw new Error(`Daily loss limit (${this.config.risk.dailyLossLimitPct}%) reached - new positions paused until tomorrow (UTC)`);
      }
      let amount = Number(quoteAmount);
      if (!amount) {
        const sized = sizeBuy(
          { equity: portfolio.equity, cash: portfolio.cash, price, stopLoss: signal?.shortStop, side: 'short', currentPositionValue: shortPosition?.value || 0 },
          this.config.risk
        );
        if (!sized.amount) throw new Error(sized.reason);
        amount = sized.amount;
      }
      if (amount < this.config.risk.minOrderSize) throw new Error(`Minimum order is ${this.config.risk.minOrderSize} ${this.config.quote}`);
      fill = await this.broker.openShort(symbol, amount, price);
      const prev = this.shorts[symbol];
      this.shorts[symbol] = {
        stopLoss: signal ? signal.shortStop : prev?.stopLoss ?? null,
        takeProfit: signal ? signal.shortTarget : prev?.takeProfit ?? null,
        trailAtrMult: signal ? signal.trailAtrMult ?? null : prev?.trailAtrMult ?? null,
        lowest: Math.min(prev?.lowest || Infinity, fill.price),
        openedAt: prev?.openedAt || Date.now(),
      };
      writeJson(this.shortsFile, this.shorts);
    } else if (side === 'cover') {
      if (!shortPosition) throw new Error(`No ${symbol.split('/')[0]} short to cover`);
      const pct = Math.min(Math.max(Number(percent) || 100, 0), 100);
      fill = await this.broker.coverShort(symbol, shortPosition.amount * (pct / 100), price);
      fill.realizedPnl = fill.grossPnl - fill.fee;
      if (pct >= 100) delete this.shorts[symbol];
      writeJson(this.shortsFile, this.shorts);
    } else {
      throw new Error(`Invalid side "${side}"`);
    }

    const trade = { ...fill, source, reason, mode: this.broker.mode, time: Date.now() };
    this.trades.unshift(trade);
    this.trades.length = Math.min(this.trades.length, MAX_TRADES);
    writeJson(this.positionsFile, this.positions);
    writeJson(this.tradesFile, this.trades);
    await this.refreshBalances().catch(() => {});

    const pnl = trade.realizedPnl !== undefined ? ` | P&L ${trade.realizedPnl >= 0 ? '+' : ''}${fmt(trade.realizedPnl)}` : '';
    this.addAlert('trade', `[${this.broker.mode.toUpperCase()}] ${side.toUpperCase()} ${fmtAmt(fill.amount)} ${symbol} @ ${fmt(fill.price)} (${source})${pnl}`, true);
    this.emit('trade', trade);
    return trade;
  }

  // Lets the user move a stop-loss / take-profit from the dashboard.
  setStops(symbol, { stopLoss, takeProfit }) {
    const meta = this.positions[symbol];
    if (!meta) throw new Error(`No tracked position for ${symbol}`);
    if (stopLoss !== undefined) meta.stopLoss = stopLoss === null ? null : Number(stopLoss);
    if (takeProfit !== undefined) meta.takeProfit = takeProfit === null ? null : Number(takeProfit);
    writeJson(this.positionsFile, this.positions);
    return meta;
  }

  clearHistory() {
    this.positions = {};
    this.shorts = {};
    writeJson(this.shortsFile, this.shorts);
    this.trades = [];
    writeJson(this.positionsFile, this.positions);
    writeJson(this.tradesFile, this.trades);
  }

  // --------------------------------------------------------------- portfolio

  async refreshBalances() {
    this.balances = await this.broker.getBalances();
    return this.balances;
  }

  // Uses cached balances unless `fresh` is set, so live price updates don't
  // hit the exchange's account API every second.
  async getPortfolio({ fresh = false } = {}) {
    if (fresh || !this.balances) await this.refreshBalances();
    return this.portfolioSnapshot();
  }

  portfolioSnapshot() {
    const { cash, holdings, shorts = {} } = this.balances || { cash: 0, holdings: {} };
    const positions = [];
    for (const symbol of this.config.symbols) {
      const base = symbol.split('/')[0];
      const amount = holdings[base] || 0;
      if (amount <= 0) continue;
      const price = this.prices[symbol] || 0;
      const meta = this.positions[symbol];
      const value = amount * price;
      const entry = meta?.entryPrice;
      positions.push({
        symbol,
        side: 'long',
        amount,
        price,
        value,
        entryPrice: entry ?? null,
        pnl: entry ? (price - entry) * amount : null,
        pnlPct: entry ? ((price - entry) / entry) * 100 : null,
        stopLoss: meta?.stopLoss ?? null,
        takeProfit: meta?.takeProfit ?? null,
        trailing: Boolean(meta?.trailAtrMult),
      });
    }
    // Shorts: `value` is the size of the bet; the account gains (entry - price).
    let collateral = 0;
    for (const symbol of this.config.symbols) {
      const short = shorts[symbol.split('/')[0]];
      if (!short || short.amount <= 0) continue;
      const price = this.prices[symbol] || 0;
      const meta = this.shorts[symbol];
      collateral += short.amount * short.entry;
      positions.push({
        symbol,
        side: 'short',
        amount: short.amount,
        price,
        value: short.amount * price,
        entryPrice: short.entry,
        pnl: (short.entry - price) * short.amount,
        pnlPct: ((short.entry - price) / short.entry) * 100,
        stopLoss: meta?.stopLoss ?? null,
        takeProfit: meta?.takeProfit ?? null,
        trailing: Boolean(meta?.trailAtrMult),
      });
    }
    // cash is free cash; short collateral is still the account's money, plus/minus the shorts' P&L.
    const longValue = positions.filter((p) => p.side === 'long').reduce((sum, p) => sum + p.value, 0);
    const shortPnl = positions.filter((p) => p.side === 'short').reduce((sum, p) => sum + p.pnl, 0);
    const equity = cash + longValue + collateral + shortPnl;
    return { cash, collateral, equity, positions, quote: this.config.quote, shorting: this.allowShort };
  }

  // ------------------------------------------------------------------ charts

  // Everything the big chart needs: candles, indicator lines, where signals
  // changed (the same moments that produce alerts), trades and open levels.
  chartData(symbol) {
    const candles = this.candles[symbol];
    if (!candles) return null;
    const tf = timeframeMs(this.config.timeframe);
    const st = this.config.strategy;
    const forming = candles[candles.length - 1][0] + tf > Date.now();
    const closed = forming ? candles.slice(0, -1) : candles;
    const s = computeSeries(closed);

    // Mark a BUY or SELL only when it differs from the previous BUY/SELL, so a
    // BUY -> HOLD -> BUY wobble (still the same position) shows one arrow.
    const signals = [];
    let last = null;
    for (let i = MIN_CANDLES - 1; i < closed.length; i++) {
      const r = evaluateAt(s, i, st);
      if (r.signal === 'HOLD' || r.signal === last) continue;
      if (last !== null) signals.push({ time: closed[i][0], signal: r.signal, price: closed[i][4], score: r.score });
      last = r.signal;
    }

    const closes = candles.map((c) => c[4]);
    const line = (name, color, values, style = 'solid') => ({
      name,
      color,
      style,
      points: values.map((v, i) => (v === null ? null : { time: candles[i][0], value: v })).filter(Boolean),
    });
    const lines = [];
    if (st.mode === 'ma') {
      const ma = ind.sma(closes, st.maPeriod);
      lines.push(line(`${st.maPeriod}-candle average`, '#d29922', ma));
      if (st.buyThreshold) lines.push(line(`Buy level (+${st.buyThreshold}%)`, '#3fb68b', ma.map((v) => (v === null ? null : v * (1 + st.buyThreshold / 100))), 'dashed'));
      if (st.sellThreshold) lines.push(line(`Sell level (${st.sellThreshold}%)`, '#e5636b', ma.map((v) => (v === null ? null : v * (1 + st.sellThreshold / 100))), 'dashed'));
    } else {
      lines.push(line('EMA 50', '#58a6ff', ind.ema(closes, 50)));
      lines.push(line('EMA 200', '#d29922', ind.ema(closes, 200)));
    }

    const trades = this.trades
      .filter((t) => t.symbol === symbol)
      .map((t) => ({ time: Math.floor(t.time / tf) * tf, side: t.side, price: t.price, amount: t.amount, source: t.source }));
    const meta = this.positions[symbol];
    const shortMeta = this.shorts[symbol];
    const shortEntry = this.balances?.shorts?.[symbol.split('/')[0]]?.entry;
    let position = null;
    if (meta && this.holding(symbol).held) {
      position = { side: 'long', entryPrice: meta.entryPrice, stopLoss: meta.stopLoss, takeProfit: meta.takeProfit, trailing: Boolean(meta.trailAtrMult) };
    } else if (shortMeta && this.shortHolding(symbol).held) {
      position = { side: 'short', entryPrice: shortEntry, stopLoss: shortMeta.stopLoss, takeProfit: shortMeta.takeProfit, trailing: Boolean(shortMeta.trailAtrMult) };
    }

    return { symbol, timeframe: this.config.timeframe, tfMs: tf, mode: st.mode, candles, lines, signals, trades, position };
  }

  // ------------------------------------------------------------ suggestions

  // What the analysis suggests doing right now with this coin, sized with
  // the same risk rules the Buy button and auto-trader use.
  suggest(symbol, portfolio) {
    const s = this.signals[symbol];
    const price = this.prices[symbol];
    if (!s || !price || !s.indicators) return { action: 'WAIT', note: 'Waiting for enough price data' };
    const { buyThreshold, sellThreshold } = this.config.strategy;
    const position = portfolio.positions.find((p) => p.symbol === symbol && p.side === 'long');
    const held = position && position.value >= this.config.risk.minOrderSize;
    const shortPos = portfolio.positions.find((p) => p.symbol === symbol && p.side === 'short');
    const round = (n) => Math.round(n * 100) / 100;

    if (shortPos && shortPos.value >= this.config.risk.minOrderSize) {
      if (s.signal === 'BUY') {
        return {
          action: 'COVER',
          baseAmount: shortPos.amount,
          quoteAmount: shortPos.value,
          price,
          pnl: shortPos.pnl,
          pnlPct: shortPos.pnlPct,
          thenBuy: !held,
        };
      }
      return {
        action: 'KEEP_SHORT',
        note: 'No buy signal. Keep the short.',
        stopLoss: shortPos.stopLoss,
        takeProfit: shortPos.takeProfit,
        trailing: shortPos.trailing,
        mode: s.mode,
        maPeriod: s.indicators?.maPeriod ?? null,
      };
    }

    if (s.signal === 'BUY' && !held) {
      if (this.guardState.halted) return { action: 'WAIT', note: 'BUY signal, but the daily loss limit is reached. New buys resume tomorrow (UTC).' };
      // The stop/target were set at the candle close; the live price may have moved past them since.
      if (price <= s.stopLoss) return { action: 'WAIT', note: 'BUY signal, but the price has already fallen below its stop-loss. Wait for the next candle.' };
      if (s.takeProfit && price >= s.takeProfit) return { action: 'WAIT', note: 'BUY signal, but the price already reached its target. Too late to enter; wait for the next setup.' };
      const sized = sizeBuy(
        { equity: portfolio.equity, cash: portfolio.cash, price, stopLoss: s.stopLoss, currentPositionValue: 0 },
        this.config.risk
      );
      if (!sized.amount) return { action: 'WAIT', note: `BUY signal, but ${sized.reason.toLowerCase()}.` };
      const amount = sized.amount;
      // Moving-average mode has no stop: it exits when the price closes below the average.
      const stopPct = s.stopLoss === null ? null : ((s.stopLoss - price) / price) * 100;
      const targetPct = s.takeProfit ? ((s.takeProfit - price) / price) * 100 : null;
      return {
        action: 'BUY',
        quoteAmount: amount,
        baseAmount: amount / price,
        price,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        trailAtrMult: s.trailAtrMult,
        trailDistance: s.trailAtrMult ? s.trailAtrMult * s.indicators.atr : null,
        stopPct,
        targetPct,
        riskAmount: stopPct === null ? null : (amount * -stopPct) / 100,
        rewardAmount: targetPct === null ? null : (amount * targetPct) / 100,
        rewardRisk: targetPct === null || stopPct === null ? null : targetPct / -stopPct,
        mode: s.mode,
        ma: s.indicators.ma ?? null,
        maPeriod: s.indicators.maPeriod ?? null,
        sellThreshold: this.config.strategy.sellThreshold,
        equityPct: (amount / portfolio.equity) * 100,
      };
    }
    if (s.signal === 'SELL' && held) {
      return {
        action: 'SELL',
        thenShort: this.allowShort && Boolean(s.canShort),
        percent: 100,
        baseAmount: position.amount,
        quoteAmount: position.value,
        price,
        pnl: position.pnl,
        pnlPct: position.pnlPct,
      };
    }
    if (s.signal === 'SELL' && this.allowShort) {
      if (!s.canShort) return { action: 'AVOID', note: "Bearish, but trend mode only shorts in a downtrend (price and EMA50 below EMA200). Don't buy." };
      if (this.guardState.halted) return { action: 'WAIT', note: 'SELL signal, but the daily loss limit is reached. New positions resume tomorrow (UTC).' };
      if (s.shortStop && price >= s.shortStop) return { action: 'WAIT', note: 'SELL signal, but the price has already risen above the short stop. Wait for the next candle.' };
      if (s.shortTarget && price <= s.shortTarget) return { action: 'WAIT', note: 'SELL signal, but the price already fell to the short target. Too late to enter.' };
      const sized = sizeBuy({ equity: portfolio.equity, cash: portfolio.cash, price, stopLoss: s.shortStop, side: 'short' }, this.config.risk);
      if (!sized.amount) return { action: 'WAIT', note: `SELL signal, but ${sized.reason.toLowerCase()}.` };
      const amount = sized.amount;
      const stopPct = s.shortStop ? ((s.shortStop - price) / price) * 100 : null;
      const targetPct = s.shortTarget ? ((price - s.shortTarget) / price) * 100 : null;
      return {
        action: 'SHORT',
        quoteAmount: amount,
        baseAmount: amount / price,
        price,
        stopLoss: s.shortStop,
        takeProfit: s.shortTarget,
        trailAtrMult: s.trailAtrMult,
        trailDistance: s.trailAtrMult ? s.trailAtrMult * s.indicators.atr : null,
        stopPct,
        targetPct,
        riskAmount: stopPct === null ? null : (amount * stopPct) / 100,
        rewardAmount: targetPct === null ? null : (amount * targetPct) / 100,
        rewardRisk: targetPct === null || stopPct === null ? null : targetPct / stopPct,
        equityPct: (amount / portfolio.equity) * 100,
        borrowApr: this.config.shortCostApr,
        mode: s.mode,
        ma: s.indicators.ma ?? null,
        maPeriod: s.indicators.maPeriod ?? null,
        buyThreshold,
      };
    }
    if (s.signal === 'SELL') return { action: 'AVOID', note: `Bearish. Don't buy ${symbol.split('/')[0]} now; you hold none to sell.` };
    if (held) {
      return {
        action: 'KEEP',
        note: s.signal === 'BUY' ? 'Still bullish. Keep your position.' : 'No exit signal. Keep your position.',
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        trailing: Boolean(this.positions[symbol]?.trailAtrMult),
        mode: s.mode,
        maPeriod: s.indicators?.maPeriod ?? null,
      };
    }
    if (s.score >= buyThreshold) {
      return { action: 'WAIT', note: 'Score is high enough, but trend mode only buys in an uptrend (price and EMA50 above EMA200).' };
    }
    if (s.mode === 'ma') {
      return { action: 'WAIT', note: `No trade. BUY needs the price ${round(buyThreshold - s.score)}% higher relative to its average.` };
    }
    return {
      action: 'WAIT',
      note: `No trade. Needs ${round(buyThreshold - s.score)} more points for BUY.`,
      toBuy: round(buyThreshold - s.score),
      toSell: round(s.score - sellThreshold),
    };
  }

  // An options trade that fits the signal (estimate only; see options.js).
  optionIdeaFor(symbol, s) {
    const candles = this.candles[symbol];
    const price = this.prices[symbol];
    if (!candles || !price) return null;
    const holding = this.holding(symbol).held;
    let direction = null;
    if (s.signal === 'BUY' || (s.signal === 'HOLD' && holding)) direction = 'bullish';
    else if (s.signal === 'SELL') direction = 'bearish';
    if (!direction) return null;
    const tf = timeframeMs(this.config.timeframe);
    return optionIdea({ direction, price, closes: candles.map((c) => c[4]), tfMs: tf, holding });
  }

  // Everything the dashboard shows, built from cached data (no API calls).
  snapshot() {
    const portfolio = this.portfolioSnapshot();
    const signals = this.config.symbols.map((symbol) => {
      const s = this.signals[symbol];
      if (!s) return { symbol, signal: 'LOADING', livePrice: this.prices[symbol] };
      return {
        ...s,
        livePrice: this.prices[symbol] ?? s.livePrice,
        suggestion: this.suggest(symbol, portfolio),
        optionIdea: this.optionIdeaFor(symbol, s),
      };
    });
    const lastPriceAt = Math.max(0, ...Object.values(this.priceAt));
    return { signals, portfolio, priceFeed: { ...this.priceFeed, lastPriceAt: lastPriceAt || null }, serverTime: Date.now() };
  }

  // ------------------------------------------------------------------- misc

  addAlert(type, text, notify = false) {
    const alert = { type, text, time: Date.now() };
    this.alerts.unshift(alert);
    this.alerts.length = Math.min(this.alerts.length, MAX_ALERTS);
    console.log(`[${new Date(alert.time).toISOString()}] ${type.toUpperCase()}: ${text}`);
    this.emit('alert', alert);
    if (notify && this.notifier?.enabled) this.notifier.send(text);
  }

  setAutoTrade(enabled) {
    this.autoTrade = Boolean(enabled);
    this.addAlert('info', `Auto-trading ${this.autoTrade ? 'ENABLED' : 'disabled'}`);
  }

  start() {
    if (this.shortBlockedReason) this.addAlert('info', this.shortBlockedReason);
    this.scan();
    this.timer = setInterval(() => this.scan(), this.config.scanIntervalSec * 1000);
    if (this.marketData.streamPrices) {
      this.stopFeed = this.marketData.streamPrices(
        this.config.symbols,
        (prices) => this.onPrices(prices),
        (mode, message) => {
          // Log every stream problem (each has its own attempt count), other modes once.
          const changed = mode !== this.priceFeed.mode || (mode === 'error' && message !== this.priceFeed.message);
          this.priceFeed = { mode, message };
          if (changed) this.addAlert(mode === 'error' ? 'error' : 'info', message);
        }
      );
    }
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.closeTimer);
    if (this.stopFeed) this.stopFeed();
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const fmt = (n) => {
  const abs = Math.abs(n);
  return n.toFixed(abs >= 100 ? 2 : abs >= 1 ? 3 : 5);
};
const fmtAmt = (n) => Number(n.toPrecision(6)).toString();

module.exports = { TradingEngine };
