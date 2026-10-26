const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { PaperBroker } = require('../src/brokers/paperBroker');
const { TradingEngine } = require('../src/engine');
const { DemoMarketData } = require('../src/marketData');
const { candidateMarkets, filterByRank, volatilityStats } = require('../src/screen');

const risk = { riskPerTradePct: 1, maxPositionPct: 25, dailyLossLimitPct: 5, minOrderSize: 10 };
const alwaysBuy = { buyThreshold: -100, sellThreshold: -200 };

function makeEngine({ dayAutoTrade = false } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const main = { name: 'main', label: 'Swing', symbols: ['BTC/USDT'], timeframe: '1h', strategy: { mode: 'classic', ...alwaysBuy }, risk, autoTrade: true };
  const day = {
    name: 'day', label: 'Day', symbols: ['DOGE/USDT'], timeframe: '15m',
    strategy: { mode: 'ma', maPeriod: 50, ...alwaysBuy },
    risk: { ...risk, maxPositionPct: 10 }, autoTrade: dayAutoTrade,
  };
  const config = {
    symbols: ['BTC/USDT', 'DOGE/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300, autoTrade: true, enforceStops: true,
    risk, strategy: main.strategy, dataDir, groups: [main, day],
    settingsFor: (s) => (day.symbols.includes(s) ? day : main),
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  return new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
}

test('each group analyzes its own timeframe and strategy', async () => {
  const engine = makeEngine();
  await engine.scan();
  const gap = (sym) => engine.candles[sym][1][0] - engine.candles[sym][0][0];
  assert.strictEqual(gap('BTC/USDT'), 3600e3);
  assert.strictEqual(gap('DOGE/USDT'), 900e3);
  assert.strictEqual(engine.signals['BTC/USDT'].mode, 'classic');
  assert.strictEqual(engine.signals['DOGE/USDT'].mode, 'ma');
  const snap = engine.snapshot().signals.find((s) => s.symbol === 'DOGE/USDT');
  assert.deepStrictEqual([snap.settings.group, snap.settings.timeframe, snap.settings.autoTrade], ['day', '15m', false]);
});

test('day coins are signals only unless the day group auto-trades', async () => {
  const off = makeEngine();
  await off.scan();
  assert.deepStrictEqual(off.trades.map((t) => t.symbol), ['BTC/USDT']);

  const on = makeEngine({ dayAutoTrade: true });
  await on.scan();
  assert.deepStrictEqual(on.trades.map((t) => t.symbol).sort(), ['BTC/USDT', 'DOGE/USDT']);
});

test('day coins use the day position limit', async () => {
  const engine = makeEngine();
  await engine.scan();
  const g = engine.suggest('DOGE/USDT', await engine.getPortfolio());
  assert.strictEqual(g.action, 'BUY');
  assert.ok(g.quoteAmount <= 0.1 * 10000 + 1e-6, `capped at 10%: ${g.quoteAmount}`);
});

test('screener keeps liquid, non-stable, top-ranked coins', () => {
  const markets = {
    'DOGE/USDT': { symbol: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', spot: true, active: true },
    'AVAX/USDT': { symbol: 'AVAX/USDT', base: 'AVAX', quote: 'USDT', spot: true, active: true },
    'USDC/USDT': { symbol: 'USDC/USDT', base: 'USDC', quote: 'USDT', spot: true, active: true },
    'WBTC/USDT': { symbol: 'WBTC/USDT', base: 'WBTC', quote: 'USDT', spot: true, active: true },
    'BTC/USDT': { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', spot: true, active: true },
    'TINY/USDT': { symbol: 'TINY/USDT', base: 'TINY', quote: 'USDT', spot: true, active: true },
    'OLD/USDT': { symbol: 'OLD/USDT', base: 'OLD', quote: 'USDT', spot: true, active: false },
    'DOGE/USD': { symbol: 'DOGE/USD', base: 'DOGE', quote: 'USD', spot: true, active: true },
  };
  const candidates = candidateMarkets(markets, 'USDT', ['BTC']);
  assert.deepStrictEqual(candidates.map((c) => c.base).sort(), ['AVAX', 'DOGE', 'TINY']);

  const tickers = { 'DOGE/USDT': { quoteVolume: 5e6 }, 'AVAX/USDT': { quoteVolume: 2e6 }, 'TINY/USDT': { quoteVolume: 5e3 } };
  const ranked = filterByRank(candidates, tickers, { DOGE: 9, AVAX: 70 }, 50);
  assert.deepStrictEqual(ranked.map((c) => c.base), ['DOGE'], 'AVAX outside top 50, TINY too illiquid');

  const byVolume = filterByRank(candidates, tickers, null, 1);
  assert.deepStrictEqual(byVolume.map((c) => c.base), ['DOGE'], 'without ranks, volume decides');
});

test('screener volatility: wider daily swings score higher', () => {
  const day = 86400e3;
  const make = (swing) => Array.from({ length: 31 }, (_, i) => {
    const c = 100 * (1 + (i % 2 ? swing : -swing));
    return [i * day, 100, c * 1.01, c * 0.99, c, 1000];
  });
  const calm = volatilityStats(make(0.01));
  const wild = volatilityStats(make(0.05));
  assert.ok(wild.volatilityPct > calm.volatilityPct * 3);
});
