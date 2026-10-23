const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { sizeBuy, DailyLossGuard } = require('../src/risk');
const { PaperBroker, FEE_RATE } = require('../src/brokers/paperBroker');
const { TradingEngine } = require('../src/engine');
const { DemoMarketData } = require('../src/marketData');
const { backtest } = require('../src/backtest');

const risk = { riskPerTradePct: 1, maxPositionPct: 25, dailyLossLimitPct: 5, minOrderSize: 10 };

test('sizeBuy risks the configured % of equity at the stop', () => {
  // 1% of 10k = 100 risk, 5% stop distance -> 2000 position
  const r = sizeBuy({ equity: 10000, cash: 10000, price: 100, stopLoss: 95 }, risk);
  assert.strictEqual(r.amount, 2000);
});

test('sizeBuy caps at max position and cash', () => {
  const r = sizeBuy({ equity: 10000, cash: 10000, price: 100, stopLoss: 99.9 }, risk);
  assert.strictEqual(r.amount, 2500);
  const r2 = sizeBuy({ equity: 10000, cash: 5, price: 100, stopLoss: 95 }, risk);
  assert.strictEqual(r2.amount, 0);
  const r3 = sizeBuy({ equity: 10000, cash: 9000, price: 100, stopLoss: 95, currentPositionValue: 2500 }, risk);
  assert.strictEqual(r3.reason, 'Max position size reached');
});

test('daily loss guard halts after the limit and resets the next day', () => {
  const g = new DailyLossGuard(5);
  assert.strictEqual(g.update(10000, new Date('2026-01-01T01:00Z')).halted, false);
  assert.strictEqual(g.update(9400, new Date('2026-01-01T05:00Z')).halted, true);
  assert.strictEqual(g.update(9400, new Date('2026-01-02T00:10Z')).halted, false);
});

test('paper broker charges fees on round trips', async () => {
  const b = new PaperBroker({ quote: 'USDT', paperStartingBalance: 1000 }, { persist: false });
  const buy = await b.buy('BTC/USDT', 500, 100);
  await b.sell('BTC/USDT', buy.amount, 100);
  const { cash, holdings } = await b.getBalances();
  assert.deepStrictEqual(holdings, {});
  assert.ok(cash < 1000 && cash > 1000 - 500 * FEE_RATE * 3);
  await assert.rejects(b.sell('BTC/USDT', 1, 100), /Insufficient/);
});

function makeEngine(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const config = {
    symbols: ['BTC/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300,
    autoTrade: false, enforceStops: true, risk, strategy: { buyThreshold: 3, sellThreshold: -3 }, dataDir, ...overrides,
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  return new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
}

test('engine places manual orders and tracks the position', async () => {
  const engine = makeEngine();
  await engine.scan();
  assert.ok(engine.signals['BTC/USDT']);
  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'buy', quoteAmount: 1000 });
  let p = await engine.getPortfolio();
  assert.strictEqual(p.positions.length, 1);
  assert.ok(engine.positions['BTC/USDT'].stopLoss > 0);
  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'sell', percent: 100 });
  p = await engine.getPortfolio();
  assert.strictEqual(p.positions.length, 0);
  assert.strictEqual(engine.trades.length, 2);
  assert.ok('realizedPnl' in engine.trades[0]);
});

test('engine enforces stop-loss', async () => {
  const engine = makeEngine();
  await engine.scan();
  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'buy', quoteAmount: 1000 });
  engine.setStops('BTC/USDT', { stopLoss: engine.prices['BTC/USDT'] * 2 });
  await engine.scan();
  assert.strictEqual(engine.trades[0].source, 'stop-loss');
  assert.strictEqual((await engine.getPortfolio()).positions.length, 0);
});

test('auto-trade buys on a BUY signal only once per candle', async () => {
  // Thresholds that make every bar a BUY
  const engine = makeEngine({ autoTrade: true, strategy: { buyThreshold: -100, sellThreshold: -200 } });
  await engine.scan();
  await engine.scan();
  assert.strictEqual(engine.trades.length, 1);
  assert.strictEqual(engine.trades[0].source, 'auto');
  assert.strictEqual(engine.trades[0].side, 'buy');
});

test('backtest runs end to end on demo data', async () => {
  const candles = await new DemoMarketData().fetchHistory('ETH/USDT', '1h', 1500);
  const r = backtest(candles, { risk, strategy: { buyThreshold: 3, sellThreshold: -3 } });
  assert.ok(Number.isFinite(r.returnPct));
  assert.ok(r.maxDrawdownPct >= 0);
});
