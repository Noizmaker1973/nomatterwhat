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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns a CCXT tickers map into { 'BTC/USDT': lastPrice, ... }.
function lastPrices(tickers, symbols) {
  const out = {};
  for (const symbol of symbols) {
    const last = tickers[symbol]?.last;
    if (last) out[symbol] = last;
  }
  return out;
}

class ExchangeMarketData {
  constructor(config, exchange) {
    this.exchange = exchange || createExchange(config);
    this.name = config.exchange;
    this.pollMs = (config.pricePollSec || 2) * 1000;
    // A stream that sends nothing for this long is treated as broken.
    this.streamTimeoutMs = 15000;
    // While streaming, also refresh every price over REST this often, so a
    // coin whose stream stalls can't go stale.
    this.backupRefreshMs = 10000;
    this.reconnectDelayMs = 1000; // grows with each failed attempt
  }

  // Overridable in tests.
  createStream() {
    const ProClass = ccxt.pro?.[this.exchange.id];
    return ProClass ? new ProClass({ enableRateLimit: true }) : null;
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

  async fetchPrices(symbols) {
    if (this.exchange.has.fetchTickers) return lastPrices(await this.exchange.fetchTickers(symbols), symbols);
    const tickers = await Promise.all(symbols.map((s) => this.exchange.fetchTicker(s)));
    return lastPrices(Object.fromEntries(tickers.map((t) => [t.symbol, t])), symbols);
  }

  // Calls onPrices({ symbol: price }) every time prices change. Uses the
  // exchange's WebSocket feed when CCXT supports it, and falls back to
  // polling the REST API every few seconds if the stream keeps failing.
  // onStatus(mode, message) reports 'stream', 'polling' or 'error'.
  // Returns a function that stops the feed.
  streamPrices(symbols, onPrices, onStatus = () => {}) {
    let stopped = false;
    let ws = null;

    const withTimeout = (promise, ms) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no price updates for ${ms / 1000}s`)), ms);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };

    const runStream = async () => {
      ws = this.createStream();
      if (!ws || (!ws.has.watchTickers && !ws.has.watchTicker)) return;
      const watch = () =>
        ws.has.watchTickers
          ? ws.watchTickers(symbols)
          : Promise.race(symbols.map((s) => ws.watchTicker(s).then((t) => ({ [s]: t }))));

      const backup = setInterval(() => {
        this.fetchPrices(symbols).then(onPrices, () => {});
      }, this.backupRefreshMs);

      let failures = 0;
      let healthy = 0; // consecutive updates since the last problem
      let announced = false;
      try {
        while (!stopped && failures < 3) {
          try {
            const prices = lastPrices(await withTimeout(watch(), this.streamTimeoutMs), symbols);
            // One update after a reconnect doesn't prove the stream is fixed;
            // only a steady run of updates clears the failure count.
            if (++healthy >= 10) failures = 0;
            if (!announced) {
              onStatus('stream', `Streaming live prices from ${this.exchange.id}`);
              announced = true;
            }
            onPrices(prices);
          } catch (err) {
            if (stopped) return;
            failures++;
            healthy = 0;
            announced = false;
            onStatus('error', `Price stream problem (${failures}/3): ${err.message}. Reconnecting.`);
            // Start over with a fresh connection; a stalled one rarely recovers.
            await ws.close().catch(() => {});
            await sleep(this.reconnectDelayMs * failures);
            ws = this.createStream();
          }
        }
      } finally {
        clearInterval(backup);
        await ws.close().catch(() => {});
      }
    };

    const runPolling = async () => {
      onStatus('polling', `Polling prices every ${this.pollMs / 1000}s`);
      let failing = false;
      while (!stopped) {
        try {
          onPrices(await this.fetchPrices(symbols));
          if (failing) onStatus('polling', 'Price polling recovered');
          failing = false;
        } catch (err) {
          failing = true;
          onStatus('error', `Price polling error: ${err.message}`);
        }
        await sleep(this.pollMs);
      }
    };

    runStream()
      .catch((err) => onStatus('error', `Price stream unavailable: ${err.message}`))
      .then(() => !stopped && runPolling());

    return () => {
      stopped = true;
      if (ws) ws.close().catch(() => {});
    };
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
  constructor(config = {}) {
    this.name = 'demo';
    this.timeframe = config.timeframe || '1h';
  }

  params(symbol) {
    const baseCcy = symbol.split('/')[0];
    return { base: DEMO_BASE[baseCcy] || 100, seed: [...baseCcy].reduce((a, ch) => a + ch.charCodeAt(0), 0) };
  }

  closeAt(symbol, index) {
    const { base, seed } = this.params(symbol);
    const logPrice =
      0.18 * Math.sin((index + seed * 7) / 160) +
      0.07 * Math.sin((index + seed) / 41) +
      0.025 * Math.sin((index + seed * 3) / 11) +
      0.012 * (hash(index + seed) - 0.5);
    return base * Math.exp(logPrice);
  }

  candleAt(symbol, tfMs, index) {
    const { base, seed } = this.params(symbol);
    const open = this.closeAt(symbol, index - 1);
    const close = this.closeAt(symbol, index);
    const wick = Math.abs(close - open) + base * 0.003 * hash(index * 3 + seed);
    const high = Math.max(open, close) + wick * hash(index * 5 + seed);
    const low = Math.min(open, close) - wick * hash(index * 7 + seed);
    const spike = hash(index * 11 + seed) > 0.92 ? 2.5 : 1;
    const volume = (1000 + 800 * hash(index * 13 + seed)) * spike * (65000 / base);
    return [index * tfMs, open, high, low, close, volume];
  }

  // The current price drifts from the forming candle's open towards its
  // close as the candle progresses, with a little second-by-second wiggle.
  livePrice(symbol, now = Date.now()) {
    const tfMs = timeframeMs(this.timeframe);
    const index = Math.floor(now / tfMs);
    const progress = (now % tfMs) / tfMs;
    const open = this.closeAt(symbol, index - 1);
    const close = this.closeAt(symbol, index);
    const { base, seed } = this.params(symbol);
    const wiggle = base * 0.0015 * Math.sin(now / 2300 + seed) * Math.sin(now / 7100 + seed * 2);
    return open + (close - open) * progress + wiggle;
  }

  async fetchCandles(symbol, timeframe, limit) {
    const tfMs = timeframeMs(timeframe);
    const last = Math.floor(Date.now() / tfMs);
    const out = [];
    for (let i = last - limit + 1; i <= last; i++) out.push(this.candleAt(symbol, tfMs, i));
    if (timeframe === this.timeframe) {
      // The forming candle ends at the live price, like a real exchange.
      const forming = out[out.length - 1];
      const price = this.livePrice(symbol);
      forming[4] = price;
      forming[2] = Math.max(forming[1], price);
      forming[3] = Math.min(forming[1], price);
    }
    return out;
  }

  async fetchHistory(symbol, timeframe, total) {
    return this.fetchCandles(symbol, timeframe, total);
  }

  async fetchPrice(symbol) {
    return this.livePrice(symbol);
  }

  async fetchPrices(symbols) {
    return Object.fromEntries(symbols.map((s) => [s, this.livePrice(s)]));
  }

  streamPrices(symbols, onPrices, onStatus = () => {}) {
    onStatus('stream', 'Streaming demo prices');
    const timer = setInterval(() => this.fetchPrices(symbols).then(onPrices), 1000);
    return () => clearInterval(timer);
  }
}

function createMarketData(config) {
  return config.dataSource === 'demo' ? new DemoMarketData(config) : new ExchangeMarketData(config);
}

module.exports = { createExchange, createMarketData, timeframeMs, DemoMarketData, ExchangeMarketData };
