// Market data: real candles from an exchange via CCXT, or a synthetic
// "demo" feed for trying the platform offline.

const ccxt = require('ccxt');

function createExchange(config, { withKeys = false } = {}) {
  const ExchangeClass = ccxt[config.exchange];
  if (!ExchangeClass) {
    throw new Error(`Unknown exchange "${config.exchange}". See https://github.com/ccxt/ccxt#supported-cryptocurrency-exchanges`);
  }
  const options = { enableRateLimit: true };
  if (withKeys) {
    options.apiKey = config.apiKey;
    options.secret = config.apiSecret;
    if (config.apiPassword) options.password = config.apiPassword;
  }
  return new ExchangeClass(options);
}

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3, M: 2592000e3 };
function timeframeMs(tf) {
  const match = /^(\d+)([mhdwM])$/.exec(tf);
  if (!match) throw new Error(`Invalid timeframe "${tf}" (examples: 15m, 1h, 4h, 1d)`);
  return Number(match[1]) * UNIT_MS[match[2]];
}

class ExchangeMarketData {
  constructor(config, exchange) {
    this.exchange = exchange || createExchange(config);
    this.name = config.exchange;
  }

  async fetchCandles(symbol, timeframe, limit) {
    return this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  }

  // Pages backwards through history for backtests (exchanges cap each request).
  async fetchHistory(symbol, timeframe, total) {
    const step = timeframeMs(timeframe);
    const pageSize = 500;
    let since = Date.now() - total * step;
    const all = [];
    while (all.length < total) {
      const page = await this.exchange.fetchOHLCV(symbol, timeframe, since, pageSize);
      if (!page.length) break;
      all.push(...page);
      since = page[page.length - 1][0] + step;
      if (page.length < pageSize / 2 || since > Date.now()) break;
    }
    const unique = [...new Map(all.map((c) => [c[0], c])).values()];
    return unique.slice(-total);
  }

  async fetchPrice(symbol) {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.last;
  }
}

// Deterministic synthetic prices: overlapping cycles plus noise, so the
// strategy sees trends, pullbacks and reversals. Same inputs, same output.
const DEMO_BASE = { BTC: 65000, ETH: 3200, SOL: 150, BNB: 580 };

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

class DemoMarketData {
  constructor() {
    this.name = 'demo';
  }

  candleAt(symbol, tfMs, index) {
    const baseCcy = symbol.split('/')[0];
    const base = DEMO_BASE[baseCcy] || 100;
    const seed = [...baseCcy].reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const logPrice = (k) =>
      0.18 * Math.sin((k + seed * 7) / 160) +
      0.07 * Math.sin((k + seed) / 41) +
      0.025 * Math.sin((k + seed * 3) / 11) +
      0.012 * (hash(k + seed) - 0.5);
    const open = base * Math.exp(logPrice(index - 1));
    const close = base * Math.exp(logPrice(index));
    const wick = Math.abs(close - open) + base * 0.003 * hash(index * 3 + seed);
    const high = Math.max(open, close) + wick * hash(index * 5 + seed);
    const low = Math.min(open, close) - wick * hash(index * 7 + seed);
    const spike = hash(index * 11 + seed) > 0.92 ? 2.5 : 1;
    const volume = (1000 + 800 * hash(index * 13 + seed)) * spike * (65000 / base);
    return [index * tfMs, open, high, low, close, volume];
  }

  async fetchCandles(symbol, timeframe, limit) {
    const tfMs = timeframeMs(timeframe);
    const last = Math.floor(Date.now() / tfMs);
    const out = [];
    for (let i = last - limit + 1; i <= last; i++) out.push(this.candleAt(symbol, tfMs, i));
    return out;
  }

  async fetchHistory(symbol, timeframe, total) {
    return this.fetchCandles(symbol, timeframe, total);
  }

  async fetchPrice(symbol) {
    const [candle] = await this.fetchCandles(symbol, '1m', 1);
    return candle[4];
  }
}

function createMarketData(config) {
  return config.dataSource === 'demo' ? new DemoMarketData() : new ExchangeMarketData(config);
}

module.exports = { createExchange, createMarketData, timeframeMs, DemoMarketData, ExchangeMarketData };
