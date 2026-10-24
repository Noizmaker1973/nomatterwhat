const test = require('node:test');
const assert = require('node:assert');
const { ExchangeMarketData } = require('../src/marketData');

const symbols = ['BTC/USDT', 'ETH/USDT'];

// A fake REST exchange: fetchTickers always works.
function fakeExchange() {
  return {
    id: 'fake',
    has: { fetchTickers: true },
    restCalls: 0,
    async fetchTickers() {
      this.restCalls++;
      return { 'BTC/USDT': { last: 100 }, 'ETH/USDT': { last: 10 } };
    },
  };
}

function makeFeed(stream) {
  const md = new ExchangeMarketData({ exchange: 'fake', pricePollSec: 0.02 }, fakeExchange());
  md.streamTimeoutMs = 40;
  md.backupRefreshMs = 30;
  md.reconnectDelayMs = 5;
  md.createStream = () => stream();
  return md;
}

const waitFor = async (cond, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('a stream that goes silent reconnects, then falls back to polling', async () => {
  let created = 0;
  const md = makeFeed(() => {
    created++;
    let first = true;
    return {
      has: { watchTickers: true },
      // Delivers one update, then never again: the failure mode a stalled socket produces.
      watchTickers: () => (first ? ((first = false), Promise.resolve({ 'BTC/USDT': { last: 101 } })) : new Promise(() => {})),
      close: async () => {},
    };
  });
  const statuses = [];
  const prices = [];
  const stop = md.streamPrices(symbols, (p) => prices.push(p), (mode, msg) => statuses.push([mode, msg]));
  try {
    await waitFor(() => statuses.some(([m]) => m === 'polling'));
    const before = prices.length;
    await waitFor(() => prices.length > before + 2); // polling keeps prices flowing
  } finally {
    stop();
  }

  assert.strictEqual(statuses[0][0], 'stream');
  assert.ok(statuses.some(([m, msg]) => m === 'error' && /no price updates/.test(msg)));
  assert.strictEqual(created, 4, 'initial connection + 3 reconnect attempts');
  assert.deepStrictEqual(prices[prices.length - 1], { 'BTC/USDT': 100, 'ETH/USDT': 10 });
});

test('a healthy stream keeps streaming, with periodic REST backup refreshes', async () => {
  let n = 0;
  const md = makeFeed(() => ({
    has: { watchTickers: true },
    watchTickers: () => new Promise((r) => setTimeout(() => r({ 'BTC/USDT': { last: 200 + n++ } }), 5)),
    close: async () => {},
  }));
  const statuses = [];
  const prices = [];
  const stop = md.streamPrices(symbols, (p) => prices.push(p), (mode) => statuses.push(mode));
  try {
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    stop();
  }
  assert.deepStrictEqual([...new Set(statuses)], ['stream']);
  assert.ok(prices.filter((p) => p['BTC/USDT'] >= 200).length > 5, 'stream updates');
  assert.ok(prices.some((p) => p['ETH/USDT'] === 10), 'backup refresh covers coins the stream is quiet on');
});

test('polling reports recovery after a failed request', async () => {
  const md = makeFeed(() => null); // no stream support: polling only
  let calls = 0;
  md.exchange.fetchTickers = async () => {
    calls++;
    if (calls === 2) throw new Error('request timed out');
    return { 'BTC/USDT': { last: 100 }, 'ETH/USDT': { last: 10 } };
  };
  const statuses = [];
  const stop = md.streamPrices(symbols, () => {}, (mode, msg) => statuses.push([mode, msg]));
  try {
    await waitFor(() => calls >= 4);
  } finally {
    stop();
  }
  const modes = statuses.map(([m]) => m);
  assert.deepStrictEqual(modes.slice(0, 3), ['polling', 'error', 'polling']);
  assert.match(statuses[2][1], /recovered/);
});
