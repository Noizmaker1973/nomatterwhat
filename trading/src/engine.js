// The trading engine: scans markets, produces signals, enforces stops and
// (optionally) trades automatically. Manual orders from the dashboard also
// go through here so they get the same sizing, logging and stop tracking.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { analyze } = require('./strategy');
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
        await this.manageSymbol(symbol, portfolio);
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

  // Protective exits run on every price update, regardless of auto-trade.
  checkStops(symbol) {
    const meta = this.positions[symbol];
    const price = this.prices[symbol];
    if (!this.config.enforceStops || !meta || this.exiting.has(symbol) || !this.holding(symbol).held) return null;
    let order = null;
    if (meta.stopLoss && price <= meta.stopLoss) {
      order = { symbol, side: 'sell', percent: 100, source: 'stop-loss', reason: `Stop-loss hit at ${fmt(meta.stopLoss)}` };
    } else if (meta.takeProfit && price >= meta.takeProfit) {
      order = { symbol, side: 'sell', percent: 100, source: 'take-profit', reason: `Take-profit hit at ${fmt(meta.takeProfit)}` };
    }
    if (!order) return null;
    this.exiting.add(symbol);
    return this.safeOrder(order).finally(() => this.exiting.delete(symbol));
  }

  async manageSymbol(symbol, portfolio) {
    const signal = this.signals[symbol];
    const position = portfolio.positions.find((p) => p.symbol === symbol);
    const held = position && position.value >= this.config.risk.minOrderSize;

    const exit = this.checkStops(symbol);
    if (exit) return exit;

    if (!this.autoTrade || this.lastActedCandle[symbol] === signal.time) return;

    if (signal.signal === 'BUY' && !held) {
      if (this.guardState.halted) return;
      this.lastActedCandle[symbol] = signal.time;
      await this.safeOrder({ symbol, side: 'buy', source: 'auto', reason: `BUY signal (score ${signal.score})` });
    } else if (signal.signal === 'SELL' && held) {
      this.lastActedCandle[symbol] = signal.time;
      await this.safeOrder({ symbol, side: 'sell', percent: 100, source: 'auto', reason: `SELL signal (score ${signal.score})` });
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
    const position = portfolio.positions.find((p) => p.symbol === symbol);
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
        takeProfit: signal?.takeProfit ?? prev?.takeProfit ?? null,
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
    const { cash, holdings } = this.balances || { cash: 0, holdings: {} };
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
        amount,
        price,
        value,
        entryPrice: entry ?? null,
        pnl: entry ? (price - entry) * amount : null,
        pnlPct: entry ? ((price - entry) / entry) * 100 : null,
        stopLoss: meta?.stopLoss ?? null,
        takeProfit: meta?.takeProfit ?? null,
      });
    }
    const equity = cash + positions.reduce((sum, p) => sum + p.value, 0);
    return { cash, equity, positions, quote: this.config.quote };
  }

  // ------------------------------------------------------------ suggestions

  // What the analysis suggests doing right now with this coin, sized with
  // the same risk rules the Buy button and auto-trader use.
  suggest(symbol, portfolio) {
    const s = this.signals[symbol];
    const price = this.prices[symbol];
    if (!s || !price || !s.indicators) return { action: 'WAIT', note: 'Waiting for enough price data' };
    const { buyThreshold, sellThreshold } = this.config.strategy;
    const position = portfolio.positions.find((p) => p.symbol === symbol);
    const held = position && position.value >= this.config.risk.minOrderSize;
    const round = (n) => Math.round(n * 100) / 100;

    if (s.signal === 'BUY' && !held) {
      if (this.guardState.halted) return { action: 'WAIT', note: 'BUY signal, but the daily loss limit is reached. New buys resume tomorrow (UTC).' };
      // The stop/target were set at the candle close; the live price may have moved past them since.
      if (price <= s.stopLoss) return { action: 'WAIT', note: 'BUY signal, but the price has already fallen below its stop-loss. Wait for the next candle.' };
      if (price >= s.takeProfit) return { action: 'WAIT', note: 'BUY signal, but the price already reached its target. Too late to enter; wait for the next setup.' };
      const sized = sizeBuy(
        { equity: portfolio.equity, cash: portfolio.cash, price, stopLoss: s.stopLoss, currentPositionValue: 0 },
        this.config.risk
      );
      if (!sized.amount) return { action: 'WAIT', note: `BUY signal, but ${sized.reason.toLowerCase()}.` };
      const amount = sized.amount;
      const stopPct = ((s.stopLoss - price) / price) * 100;
      const targetPct = ((s.takeProfit - price) / price) * 100;
      return {
        action: 'BUY',
        quoteAmount: amount,
        baseAmount: amount / price,
        price,
        stopLoss: s.stopLoss,
        takeProfit: s.takeProfit,
        stopPct,
        targetPct,
        riskAmount: (amount * -stopPct) / 100,
        rewardAmount: (amount * targetPct) / 100,
        rewardRisk: targetPct / -stopPct,
        equityPct: (amount / portfolio.equity) * 100,
      };
    }
    if (s.signal === 'SELL' && held) {
      return {
        action: 'SELL',
        percent: 100,
        baseAmount: position.amount,
        quoteAmount: position.value,
        price,
        pnl: position.pnl,
        pnlPct: position.pnlPct,
      };
    }
    if (s.signal === 'SELL') return { action: 'AVOID', note: `Bearish. Don't buy ${symbol.split('/')[0]} now; you hold none to sell.` };
    if (held) {
      return {
        action: 'KEEP',
        note: s.signal === 'BUY' ? 'Still bullish. Keep your position.' : 'No exit signal. Keep your position.',
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
      };
    }
    return {
      action: 'WAIT',
      note: `No trade. Needs ${round(buyThreshold - s.score)} more points for BUY.`,
      toBuy: round(buyThreshold - s.score),
      toSell: round(s.score - sellThreshold),
    };
  }

  // Everything the dashboard shows, built from cached data (no API calls).
  snapshot() {
    const portfolio = this.portfolioSnapshot();
    const signals = this.config.symbols.map((symbol) => {
      const s = this.signals[symbol];
      if (!s) return { symbol, signal: 'LOADING', livePrice: this.prices[symbol] };
      return { ...s, livePrice: this.prices[symbol] ?? s.livePrice, suggestion: this.suggest(symbol, portfolio) };
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
