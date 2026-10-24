const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { analyze, computeSeries, evaluateAt, scoreSeries, signalFromScore, MIN_CANDLES } = require('../src/strategy');
const { backtest } = require('../src/backtest');
const { optimize, combinations, GRID } = require('../src/optimize');
const { DemoMarketData } = require('../src/marketData');
const { PaperBroker } = require('../src/brokers/paperBroker');
const { TradingEngine } = require('../src/engine');

const candlesFrom = (closes) => closes.map((c, i) => [i * 3600e3, i ? closes[i - 1] : c, c * 1.002, c * 0.998, c, 1000]);
const risk = { riskPerTradePct: 1, maxPositionPct: 25, dailyLossLimitPct: 5, minOrderSize: 10 };

test('trend mode treats a strong uptrend as bullish, not overbought', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 * Math.exp(i * 0.004));
  const candles = candlesFrom(closes);
  const classic = analyze(candles, { mode: 'classic' });
  const trend = analyze(candles, { mode: 'trend' });
  assert.ok(classic.reasons.some((r) => /overbought/.test(r)), 'classic penalizes the high RSI');
  assert.ok(!trend.reasons.some((r) => /overbought/.test(r)));
  assert.ok(trend.score > classic.score);
  assert.strictEqual(trend.takeProfit, null);
  assert.strictEqual(trend.trailAtrMult, 3);
});

test('trend mode never buys in a downtrend', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 300 - i * 0.5);
  for (let i = 0; i < 6; i++) closes.push(closes.at(-1) * 1.02); // sharp bounce
  const r = analyze(candlesFrom(closes), { mode: 'trend', buyThreshold: -100 });
  assert.notStrictEqual(r.signal, 'BUY');
});

test('suggestion explains a high score without an uptrend in trend mode', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const config = {
    symbols: ['BTC/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300, autoTrade: false, enforceStops: true, risk, dataDir,
    strategy: { mode: 'trend', buyThreshold: 3, sellThreshold: -3, stopAtrMult: 2, trailAtrMult: 3 },
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  const engine = new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
  await engine.scan();
  Object.assign(engine.signals['BTC/USDT'], { signal: 'HOLD', score: 4 });
  const g = engine.suggest('BTC/USDT', await engine.getPortfolio());
  assert.strictEqual(g.action, 'WAIT');
  assert.match(g.note, /only buys in an uptrend/);
});

test('cached scores give the same signals as full evaluation', async () => {
  const candles = await new DemoMarketData().fetchHistory('SOL/USDT', '1h', 800);
  const s = computeSeries(candles);
  for (const mode of ['classic', 'trend']) {
    const scores = scoreSeries(s, mode);
    const opts = { mode, buyThreshold: 2, sellThreshold: -2, stopAtrMult: 1.5, targetAtrMult: 4, trailAtrMult: 2 };
    for (let i = MIN_CANDLES; i < candles.length; i++) {
      const full = evaluateAt(s, i, opts);
      const fast = signalFromScore(scores, i, s, opts);
      assert.strictEqual(fast.signal, full.signal, `${mode} bar ${i}`);
      assert.strictEqual(fast.stopLoss, full.stopLoss);
      assert.strictEqual(fast.takeProfit, full.takeProfit);
    }
  }
});

test('backtest trailing stop ratchets up and exits on the pullback', () => {
  // Uptrend, then a run-up, then a sharp drop
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.3);
  for (let i = 0; i < 20; i++) closes.push(closes.at(-1) * 1.01);
  for (let i = 0; i < 10; i++) closes.push(closes.at(-1) * 0.97);
  const candles = candlesFrom(closes);
  const r = backtest(candles, { risk, strategy: { mode: 'trend', buyThreshold: 0, sellThreshold: -100, stopAtrMult: 2, trailAtrMult: 2 } });
  const exit = r.tradeLog.find((t) => t.reason === 'trailing stop');
  assert.ok(exit, `expected a trailing-stop exit, got ${r.tradeLog.map((t) => t.reason)}`);
  assert.ok(exit.exit > exit.entry, 'trailing stop locked in a profit');
});

test('engine trails the stop on live prices and sells when it is hit', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const config = {
    symbols: ['BTC/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300, autoTrade: false, enforceStops: true, risk, dataDir,
    strategy: { mode: 'trend', buyThreshold: 3, sellThreshold: -3, stopAtrMult: 2, trailAtrMult: 3 },
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  const engine = new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
  await engine.scan();
  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'buy', quoteAmount: 1000 });
  const meta = engine.positions['BTC/USDT'];
  assert.strictEqual(meta.takeProfit, null);
  const atr = engine.signals['BTC/USDT'].indicators.atr;
  const start = meta.stopLoss;

  const high = engine.prices['BTC/USDT'] * 1.1;
  engine.onPrices({ 'BTC/USDT': high });
  assert.ok(Math.abs(meta.stopLoss - (high - 3 * atr)) < 1e-6 && meta.stopLoss > start, 'stop moved up');

  const raised = meta.stopLoss;
  engine.onPrices({ 'BTC/USDT': high * 0.999 });
  assert.strictEqual(meta.stopLoss, raised, 'stop never moves down');

  engine.onPrices({ 'BTC/USDT': raised * 0.999 });
  await engine.orderQueue;
  assert.strictEqual(engine.trades[0].source, 'trailing-stop');
  assert.ok(engine.trades[0].realizedPnl > 0);
});

test('optimizer ranks on training data and reports unseen test results', async () => {
  const md = new DemoMarketData();
  const datasets = [];
  for (const symbol of ['BTC/USDT', 'ETH/USDT']) {
    const candles = await md.fetchHistory(symbol, '1h', 1500);
    const series = computeSeries(candles);
    datasets.push({
      symbol, candles, series,
      scores: { classic: scoreSeries(series, 'classic'), trend: scoreSeries(series, 'trend') },
      split: MIN_CANDLES + Math.floor((candles.length - MIN_CANDLES) * (2 / 3)),
    });
  }
  const result = optimize(datasets, { top: 3 });
  assert.strictEqual(combinations(GRID.trend).length, 144);
  assert.strictEqual(result.best.length, 3);
  for (let k = 1; k < result.best.length; k++) {
    assert.ok(result.best[k - 1].train.returnPct >= result.best[k].train.returnPct, 'sorted by training return');
  }
  for (const b of result.best) assert.ok(Number.isFinite(b.test.returnPct) && b.test.trades >= 0);
});
