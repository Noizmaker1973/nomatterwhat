const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { analyze, computeSeries, evaluateAt, scoreSeries, signalFromScore, MIN_CANDLES } = require('../src/strategy');
const { sizeBuy, shareOfAccount } = require('../src/risk');
const { checkTimeframe } = require('../src/backtest');
const { combinations, GRID } = require('../src/optimize');
const { DemoMarketData } = require('../src/marketData');
const { PaperBroker } = require('../src/brokers/paperBroker');
const { TradingEngine } = require('../src/engine');

const candlesFrom = (closes) => closes.map((c, i) => [i * 86400e3, i ? closes[i - 1] : c, c * 1.002, c * 0.998, c, 1000]);
const risk = { riskPerTradePct: 1, maxPositionPct: 25, dailyLossLimitPct: 5, minOrderSize: 10 };
const ma = (extra) => ({ mode: 'ma', maPeriod: 200, buyThreshold: 2, sellThreshold: -2, ...extra });

test('ma mode: score is the % distance from the average, with a buffer zone', () => {
  const flat = Array(250).fill(100);
  const above = analyze(candlesFrom([...flat, 105]), ma());
  assert.ok(Math.abs(above.score - 4.98) < 0.05, `score ${above.score}`); // the 105 itself lifts the average slightly
  assert.strictEqual(above.signal, 'BUY');
  assert.strictEqual(above.stopLoss, null);
  assert.strictEqual(above.takeProfit, null);
  assert.strictEqual(analyze(candlesFrom([...flat, 101]), ma()).signal, 'HOLD', 'inside the 2% buffer');
  assert.strictEqual(analyze(candlesFrom([...flat, 95]), ma()).signal, 'SELL');
  assert.strictEqual(analyze(candlesFrom([...flat, 105]), ma({ maPeriod: 50 })).indicators.maPeriod, 50);
});

test('ma mode cached scores match full evaluation for every period', async () => {
  const candles = await new DemoMarketData().fetchHistory('ETH/USDT', '1d', 700);
  const s = computeSeries(candles);
  for (const maPeriod of GRID.ma.maPeriod) {
    const scores = scoreSeries(s, 'ma', { maPeriod });
    const opts = ma({ maPeriod, buyThreshold: 1, sellThreshold: -1 });
    for (let i = MIN_CANDLES; i < candles.length; i++) {
      assert.strictEqual(signalFromScore(scores, i, s, opts).signal, evaluateAt(s, i, opts).signal, `ma${maPeriod} bar ${i}`);
    }
  }
  assert.strictEqual(combinations(GRID.ma).length, 64);
});

test('no stop (null) sizes by the position cap; a missing signal still assumes a 5% stop', () => {
  assert.strictEqual(sizeBuy({ equity: 10000, cash: 10000, price: 100, stopLoss: null }, risk).amount, 2500);
  assert.strictEqual(sizeBuy({ equity: 10000, cash: 10000, price: 100, stopLoss: undefined }, risk).amount, 2000);
});

test('each coin backtests on its share of the account', () => {
  // 1% risk / 25% cap of the whole account = 4% / 100% of a quarter-share
  assert.deepStrictEqual(shareOfAccount(risk, 4), { ...risk, riskPerTradePct: 4, maxPositionPct: 100 });
  assert.strictEqual(shareOfAccount({ ...risk, maxPositionPct: 50 }, 4).maxPositionPct, 100);
});

test('ma mode suggestion has no stop-loss numbers and sizes to the cap', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const config = {
    symbols: ['BTC/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300, autoTrade: false, enforceStops: true, risk, dataDir,
    strategy: ma({ buyThreshold: -100, sellThreshold: -200 }), // always BUY
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  const engine = new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
  await engine.scan();
  const g = engine.suggest('BTC/USDT', await engine.getPortfolio());
  assert.strictEqual(g.action, 'BUY');
  assert.strictEqual(g.quoteAmount, 2500);
  assert.strictEqual(g.riskAmount, null);
  assert.strictEqual(g.mode, 'ma');
  assert.ok(g.ma > 0 && g.maPeriod === 200);

  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'buy' });
  assert.strictEqual(engine.positions['BTC/USDT'].stopLoss, null);
  engine.onPrices({ 'BTC/USDT': engine.prices['BTC/USDT'] * 0.5 }); // a crash doesn't trigger a stop that doesn't exist
  await engine.orderQueue;
  assert.strictEqual(engine.trades.length, 1);
});

test('timeframes PowerShell mangled into numbers get a helpful error', () => {
  assert.throws(() => checkTimeframe('1'), /PowerShell/);
  assert.strictEqual(checkTimeframe('1d'), '1d');
});

test('config resolves which group a backtest uses', () => {
  delete require.cache[require.resolve('../src/config')];
  process.env.DAY_SYMBOLS = 'DOGE,AVAX';
  const config = require('../src/config');
  try {
    assert.deepStrictEqual(config.symbols.slice(-2), ['DOGE/USDT', 'AVAX/USDT']);
    assert.strictEqual(config.resolveGroup([], null).group.name, 'main');
    assert.strictEqual(config.resolveGroup(['DOGE'], null).group.name, 'day');
    assert.deepStrictEqual(config.resolveGroup([], 'day').symbols, ['DOGE/USDT', 'AVAX/USDT']);
    assert.strictEqual(config.resolveGroup(['LINK', 'SUI'], 'day').group.name, 'day', 'candidates can be tested before adding');
    assert.throws(() => config.resolveGroup(['BTC', 'DOGE'], null), /different groups/);
  } finally {
    delete process.env.DAY_SYMBOLS;
    delete require.cache[require.resolve('../src/config')];
  }
});
