import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, atr, donchian, percentileRank, bollinger, rsi } from '../src/indicators.js';

test('sma and ema warm up with nulls and match hand values', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const e = ema([1, 2, 3, 4], 2);
  assert.equal(e[0], null);
  assert.equal(e[1], 1.5);
  assert.ok(Math.abs(e[2] - (3 * (2 / 3) + 1.5 / 3)) < 1e-12);
});

test('atr of constant-range bars equals the range', () => {
  const candles = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 1, h: 1.01, l: 0.99, c: 1 }));
  const a = atr(candles, 14);
  assert.equal(a[12], null);
  assert.ok(Math.abs(a[29] - 0.02) < 1e-12);
});

test('donchian excludes the current bar', () => {
  const candles = [1, 2, 3, 10].map((x, t) => ({ t, o: x, h: x, l: x, c: x }));
  assert.deepEqual(donchian(candles, 3)[3], { high: 3, low: 1 });
});

test('percentileRank, bollinger width, rsi bounds', () => {
  assert.equal(percentileRank([1, 2, 3, 4], 3), 0.5);
  const bb = bollinger([1, 1, 1, 1], 4, 2);
  assert.equal(bb[3].width, 0);
  const up = rsi(Array.from({ length: 20 }, (_, i) => i), 14);
  assert.equal(up[19], 100);
});
