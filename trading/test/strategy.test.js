const test = require('node:test');
const assert = require('node:assert');
const { analyze, MIN_CANDLES } = require('../src/strategy');

const candlesFrom = (closes) =>
  closes.map((c, i) => [i * 3600e3, i ? closes[i - 1] : c, c * 1.002, c * 0.998, c, 1000]);

test('returns HOLD when history is too short', () => {
  const r = analyze(candlesFrom(Array.from({ length: 50 }, (_, i) => 100 + i)));
  assert.strictEqual(r.signal, 'HOLD');
  assert.match(r.reasons[0], /Not enough/);
});

test('buys a fresh breakout in an uptrend after an oversold dip', () => {
  // Long uptrend, sharp dip, then a strong rebound
  const closes = [];
  for (let i = 0; i < 260; i++) closes.push(100 + i * 0.5);
  for (let i = 0; i < 12; i++) closes.push(closes.at(-1) * 0.985);
  for (let i = 0; i < 4; i++) closes.push(closes.at(-1) * 1.02);
  const r = analyze(candlesFrom(closes));
  assert.ok(r.score > 0, `expected bullish score, got ${r.score}: ${r.reasons.join(', ')}`);
  assert.ok(r.stopLoss < r.price && r.takeProfit > r.price);
});

test('sells a breakdown in a downtrend after an overbought spike', () => {
  const closes = [];
  for (let i = 0; i < 260; i++) closes.push(300 - i * 0.5);
  for (let i = 0; i < 12; i++) closes.push(closes.at(-1) * 1.015);
  for (let i = 0; i < 4; i++) closes.push(closes.at(-1) * 0.98);
  const r = analyze(candlesFrom(closes));
  assert.ok(r.score < 0, `expected bearish score, got ${r.score}: ${r.reasons.join(', ')}`);
});

test('thresholds decide the signal', () => {
  const closes = Array.from({ length: MIN_CANDLES + 50 }, (_, i) => 100 + i);
  const r = analyze(candlesFrom(closes), { buyThreshold: -100, sellThreshold: -200 });
  assert.strictEqual(r.signal, 'BUY');
});
