import { test } from 'node:test';
import assert from 'node:assert/strict';
import { efficiencyRatio, varianceRatio, currentRange, breachStudy } from '../src/analysis/range.js';
import { synthetic } from '../src/data/synthetic.js';

const D = 86400e3;
const bars = (closes) => closes.map((c, i) => ({ t: i * D, o: c, h: c + 0.001, l: c - 0.001, c }));

test('efficiency ratio: straight line 1, zigzag ~0', () => {
  assert.equal(efficiencyRatio([1, 2, 3, 4]), 1);
  assert.equal(efficiencyRatio([1, 2, 1, 2, 1]), 0);
});

test('variance ratio: alternating returns are mean-reverting (<1)', () => {
  const zig = Array.from({ length: 200 }, (_, i) => 1 + (i % 2) * 0.01);
  assert.ok(varianceRatio(zig, 5) < 0.5);
  assert.equal(varianceRatio([1, 1.01, 1.02], 5), null);
});

test('currentRange reports width and position of the last close', () => {
  const closes = [...Array.from({ length: 80 }, (_, i) => 1 + (i % 2) * 0.02), 1.01];
  const r = currentRange(bars(closes), 60);
  assert.ok(Math.abs(r.high - 1.021) < 1e-12 && Math.abs(r.low - 0.999) < 1e-12);
  assert.ok(r.position > 0.4 && r.position < 0.6);
  assert.ok(r.efficiency < 0.05);
});

test('breach study: a flat range never breaks; a steady trend always closes outside', () => {
  const flat = breachStudy(bars(Array.from({ length: 150 }, (_, i) => 1 + (i % 2) * 0.01)), { days: 20, horizons: [5] });
  assert.equal(flat[5].expireRate, 0);
  assert.equal(flat[5].touchRate, 0);
  const up = breachStudy(bars(Array.from({ length: 150 }, (_, i) => 1 + i * 0.01)), { days: 20, horizons: [5] });
  assert.equal(up[5].expireRate, 1);
  assert.equal(up[5].upShare, 1);
  assert.ok(up[5].overshootMedianPct > 0);
});

test('breach study: wider buffer and shorter horizon never breach more; touches >= closes outside', () => {
  const c = synthetic('AUDNZD', '1d', { bars: 1500 });
  const base = breachStudy(c, { days: 60, horizons: [5, 20] });
  const wide = breachStudy(c, { days: 60, horizons: [5, 20], bufferAtr: 1 });
  assert.ok(wide[20].expireRate <= base[20].expireRate);
  assert.ok(base[5].touchRate <= base[20].touchRate);
  for (const h of [5, 20]) assert.ok(base[h].touchRate >= base[h].expireRate);
});

test('breach study sample: one row per day with a full window behind it and a full horizon ahead', () => {
  const c = synthetic('EURGBP', '1d', { bars: 720 });
  assert.equal(breachStudy(c, { days: 60, horizons: [10] })[10].n, 720 - 60 + 1 - 10);
});
