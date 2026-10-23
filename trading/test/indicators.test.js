const test = require('node:test');
const assert = require('node:assert');
const { sma, ema, rsi, macd, bollinger, atr } = require('../src/indicators');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma averages the trailing window', () => {
  assert.deepStrictEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('ema seeds with the SMA and then smooths', () => {
  const out = ema([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(out.slice(0, 2), [null, null]);
  close(out[2], 2);
  close(out[3], 3); // 4*0.5 + 2*0.5
  close(out[4], 4);
});

test('rsi is 100 for a steady rise and 0 for a steady fall', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = up.slice().reverse();
  close(rsi(up).at(-1), 100);
  close(rsi(down).at(-1), 0);
});

test('rsi matches a known reference value', () => {
  // StockCharts RSI(14) worked example. Their table rounds intermediate
  // averages, so allow a small tolerance.
  const data = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];
  const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97];
  rsi(data, 14).slice(14).forEach((v, i) => close(v, expected[i], 0.1));
});

test('macd histogram equals line minus signal', () => {
  const data = Array.from({ length: 80 }, (_, i) => 100 + 10 * Math.sin(i / 6));
  const m = macd(data);
  const i = data.length - 1;
  close(m.histogram[i], m.line[i] - m.signal[i]);
  assert.strictEqual(m.signal[25 + 7], null);
  assert.notStrictEqual(m.signal[25 + 8], null);
});

test('bollinger bands collapse on a flat series', () => {
  const b = bollinger(Array(25).fill(10), 20, 2);
  close(b.upper[24], 10);
  close(b.lower[24], 10);
});

test('atr of constant-range candles equals the range', () => {
  const n = 30;
  const highs = Array(n).fill(11);
  const lows = Array(n).fill(9);
  const closes = Array(n).fill(10);
  close(atr(highs, lows, closes, 14).at(-1), 2);
});
