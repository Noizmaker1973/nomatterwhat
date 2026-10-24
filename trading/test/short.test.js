const test = require('node:test');
const assert = require('node:assert');
const { backtest } = require('../src/backtest');
const { sizeBuy } = require('../src/risk');
const { FEE_RATE, SLIPPAGE } = require('../src/brokers/paperBroker');

const day = 86400e3;
const candlesFrom = (closes) => closes.map((c, i) => [i * day, i ? closes[i - 1] : c, Math.max(c, i ? closes[i - 1] : c) * 1.001, Math.min(c, i ? closes[i - 1] : c) * 0.999, c, 1000]);
const risk = { riskPerTradePct: 4, maxPositionPct: 100, dailyLossLimitPct: 5, minOrderSize: 10 };
const ma = (extra) => ({ mode: 'ma', maPeriod: 50, buyThreshold: 1, sellThreshold: -1, shortCostApr: 0, ...extra });

// Flat, then a long steady decline: the ideal case for a short.
const decline = [...Array(260).fill(100), ...Array.from({ length: 120 }, (_, i) => 100 * Math.exp(-0.004 * (i + 1)))];

test('long-only stays in cash during a decline; shorting profits from it', () => {
  const candles = candlesFrom(decline);
  const longOnly = backtest(candles, { risk, strategy: ma({ allowShort: false }) });
  const withShort = backtest(candles, { risk, strategy: ma({ allowShort: true }) });
  assert.strictEqual(longOnly.trades, 0);
  assert.strictEqual(withShort.shortTrades, 0, 'short still open at the end');
  assert.ok(withShort.openPosition);
  assert.ok(withShort.returnPct > 30, `short return ${withShort.returnPct}`);
});

test('short P&L math: entry minus exit, both fees, slippage against you', () => {
  // Decline then a sharp recovery so the short closes on the BUY signal.
  const closes = [...decline, ...Array.from({ length: 80 }, (_, i) => decline.at(-1) * Math.exp(0.01 * (i + 1)))];
  const r = backtest(candlesFrom(closes), { risk, strategy: ma({ allowShort: true }) });
  const short = r.tradeLog.find((t) => t.side === 'short');
  assert.ok(short, 'expected a closed short');
  assert.strictEqual(short.reason, 'buy signal');
  assert.ok(short.entry > short.exit, 'covered lower than it shorted');
  const amount = r.tradeLog.length && short.pnl; // sanity: profit is positive here
  assert.ok(amount > 0);
  // Slippage: shorted below the signal close, covered above it.
  const entryClose = closes[Math.round(short.entryTime / day)];
  assert.ok(Math.abs(short.entry - entryClose * (1 - SLIPPAGE)) < 1e-9);
});

test('borrowing cost reduces short profits', () => {
  const candles = candlesFrom(decline);
  const free = backtest(candles, { risk, strategy: ma({ allowShort: true, shortCostApr: 0 }) });
  const costly = backtest(candles, { risk, strategy: ma({ allowShort: true, shortCostApr: 50 }) });
  assert.ok(costly.finalEquity < free.finalEquity);
});

test('a short stop above the entry closes the short when the price jumps', () => {
  // Downtrend with classic signals, then a spike back above where the short
  // was opened (~174, stop ~2 ATR higher): the short should stop out.
  const closes = [...Array.from({ length: 300 }, (_, i) => 300 - i * 0.6)];
  for (let i = 0; i < 8; i++) closes.push(closes.at(-1) * 1.06);
  const strategy = { mode: 'classic', buyThreshold: 100, sellThreshold: 100, stopAtrMult: 2, targetAtrMult: 100, allowShort: true, shortCostApr: 0 };
  const r = backtest(candlesFrom(closes), { risk, strategy });
  assert.ok(r.tradeLog.some((t) => t.side === 'short' && t.reason === 'stop-loss' && t.exit > t.entry && t.pnl < 0));
});

test('short sizing uses the distance from price up to the stop', () => {
  // 1% risk, stop 5% above -> 20% of equity
  const r = sizeBuy({ equity: 10000, cash: 10000, price: 100, stopLoss: 105, side: 'short' }, { ...risk, riskPerTradePct: 1, maxPositionPct: 50 });
  assert.strictEqual(r.amount, 2000);
  assert.ok(FEE_RATE > 0);
});

// ------------------------------------------------------------ paper / engine

const os = require('os');
const fs = require('fs');
const path = require('path');
const { PaperBroker } = require('../src/brokers/paperBroker');
const { TradingEngine } = require('../src/engine');
const { DemoMarketData } = require('../src/marketData');

const engineRisk = { riskPerTradePct: 1, maxPositionPct: 25, dailyLossLimitPct: 5, minOrderSize: 10 };

function makeEngine(strategy, { supportsShort = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-'));
  const config = {
    symbols: ['BTC/USDT'], quote: 'USDT', timeframe: '1h', candleLimit: 300, autoTrade: true, enforceStops: true,
    risk: engineRisk, dataDir, shortCostApr: 10, strategy,
  };
  const broker = new PaperBroker({ ...config, paperStartingBalance: 10000 }, { persist: false });
  broker.supportsShort = supportsShort;
  return new TradingEngine(config, { marketData: new DemoMarketData(), broker, notifier: { enabled: false } });
}

test('paper short: collateral is set aside, profit when the price falls', async () => {
  const b = new PaperBroker({ quote: 'USDT', paperStartingBalance: 1000, shortCostApr: 0 }, { persist: false });
  const open = await b.openShort('BTC/USDT', 500, 100);
  let bal = await b.getBalances();
  assert.ok(Math.abs(bal.cash - (1000 - 0.5 - 500)) < 1e-9, 'fee paid, 500 held as collateral');
  await assert.rejects(b.buy('BTC/USDT', 600, 100), /Insufficient/);
  const cover = await b.coverShort('BTC/USDT', open.amount, 90);
  bal = await b.getBalances();
  assert.deepStrictEqual(bal.shorts, {});
  assert.ok(cover.grossPnl > 49 && cover.grossPnl < 50, `~10% of 500, got ${cover.grossPnl}`);
  assert.ok(bal.cash > 1040 && bal.cash < 1050);
});

test('auto-trade: SELL opens a short, BUY covers it and then buys', async () => {
  const engine = makeEngine({ mode: 'ma', maPeriod: 200, buyThreshold: 100, sellThreshold: 100, allowShort: true }); // always SELL
  await engine.scan();
  assert.strictEqual(engine.trades[0].side, 'short');
  let p = await engine.getPortfolio();
  const short = p.positions.find((x) => x.side === 'short');
  assert.ok(short && short.value > 2000, 'sized at the 25% cap (ma mode has no stop)');
  assert.ok(Math.abs(p.equity - 10000) < 10, `equity counts the collateral: ${p.equity}`);

  engine.config.strategy = { ...engine.config.strategy, buyThreshold: -100, sellThreshold: -200 }; // always BUY
  engine.lastActedCandle = {}; // as if a new candle closed
  await engine.scan();
  assert.deepStrictEqual(engine.trades.slice(0, 2).map((t) => t.side), ['buy', 'cover']);
  p = await engine.getPortfolio();
  assert.deepStrictEqual(p.positions.map((x) => x.side), ['long']);
});

test('short stop-loss triggers on a live price spike', async () => {
  const engine = makeEngine({ mode: 'classic', buyThreshold: 100, sellThreshold: 100, stopAtrMult: 2, targetAtrMult: 3, allowShort: true });
  await engine.scan();
  const meta = engine.shorts['BTC/USDT'];
  assert.ok(meta && meta.stopLoss > engine.prices['BTC/USDT']);
  engine.onPrices({ 'BTC/USDT': meta.stopLoss * 1.001 });
  await engine.orderQueue;
  assert.strictEqual(engine.trades[0].side, 'cover');
  assert.strictEqual(engine.trades[0].source, 'stop-loss');
  assert.ok(engine.trades[0].realizedPnl < 0);
});

test('shorting is refused where the broker cannot short (live Binance.US)', async () => {
  const engine = makeEngine({ mode: 'ma', maPeriod: 200, buyThreshold: 100, sellThreshold: 100, allowShort: true }, { supportsShort: false });
  assert.match(engine.shortBlockedReason, /cannot short/);
  await engine.scan();
  assert.strictEqual(engine.trades.length, 0);
  await assert.rejects(engine.placeOrder({ symbol: 'BTC/USDT', side: 'short', quoteAmount: 100 }), /cannot short/);
});

test('suggestions: SHORT when bearish and enabled, COVER on a BUY', async () => {
  const engine = makeEngine({ mode: 'ma', maPeriod: 200, buyThreshold: 100, sellThreshold: 100, allowShort: true });
  engine.autoTrade = false;
  await engine.scan();
  let g = engine.suggest('BTC/USDT', await engine.getPortfolio());
  assert.strictEqual(g.action, 'SHORT');
  assert.ok(g.quoteAmount > 0 && g.borrowApr === 10);
  await engine.placeOrder({ symbol: 'BTC/USDT', side: 'short', quoteAmount: g.quoteAmount });
  engine.signals['BTC/USDT'].signal = 'BUY';
  g = engine.suggest('BTC/USDT', await engine.getPortfolio());
  assert.strictEqual(g.action, 'COVER');
});
