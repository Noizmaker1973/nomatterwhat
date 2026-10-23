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
  }

  // ---------------------------------------------------------------- scanning

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await Promise.all(this.config.symbols.map((s) => this.scanSymbol(s)));
      const portfolio = await this.getPortfolio();
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
      const price = candles[candles.length - 1][4];

      const previous = this.signals[symbol];
      this.candles[symbol] = candles;
      this.prices[symbol] = price;
      this.signals[symbol] = { symbol, ...signal, livePrice: price, updatedAt: Date.now() };
      delete this.errors[symbol];

      const isNew = signal.signal !== 'HOLD' && (!previous || previous.signal !== signal.signal || previous.time !== signal.time);
      if (isNew) {
        const text = `${signal.signal} ${symbol} @ ${fmt(price)} (score ${signal.score}) - ${signal.reasons.slice(0, 3).join('; ')}`;
        this.addAlert(signal.signal === 'BUY' ? 'buy' : 'sell', text, true);
      }
    } catch (err) {
      this.errors[symbol] = err.message;
    }
  }

  async manageSymbol(symbol, portfolio) {
    const price = this.prices[symbol];
    const signal = this.signals[symbol];
    const position = portfolio.positions.find((p) => p.symbol === symbol);
    const held = position && position.value >= this.config.risk.minOrderSize;
    const meta = this.positions[symbol];

    // Protective exits run regardless of the auto-trade setting.
    if (held && meta && this.config.enforceStops) {
      if (meta.stopLoss && price <= meta.stopLoss) {
        return this.safeOrder({ symbol, side: 'sell', percent: 100, source: 'stop-loss', reason: `Stop-loss hit at ${fmt(meta.stopLoss)}` });
      }
      if (meta.takeProfit && price >= meta.takeProfit) {
        return this.safeOrder({ symbol, side: 'sell', percent: 100, source: 'take-profit', reason: `Take-profit hit at ${fmt(meta.takeProfit)}` });
      }
    }

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
    const portfolio = await this.getPortfolio();
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

  async getPortfolio() {
    const { cash, holdings } = await this.broker.getBalances();
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
  }

  stop() {
    clearInterval(this.timer);
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
