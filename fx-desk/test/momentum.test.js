import { test } from 'node:test';
import assert from 'node:assert/strict';
import { momentumBacktest, momentumSignalAt, combine, stats, splitAt } from '../src/signals/momentum.js';
import { parseRatesHistory, rateDiffAt } from '../src/fundamentals/rates.js';
import { synthetic } from '../src/data/synthetic.js';

const D = 86400e3;
const P = { lookbacks: [5, 10], volWindow: 5, targetVol: 0.1, maxLeverage: 3, rebalanceDays: 1, executionLagDays: 1, carryWeight: 0 };
const series = (closes) => closes.map((c, i) => ({ t: i * D, o: c, h: c, l: c, c }));
// Uptrend with alternating step sizes so realized vol is non-zero.
const trend = series(Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.002 * i + (i % 2 ? 0.003 : 0))));

test('signal uses only data up to bar i', () => {
  const candles = synthetic('EURUSD', '1d', { bars: 600 });
  const p = { ...P, lookbacks: [63, 126, 252], volWindow: 60 };
  for (let i = 260; i < 590; i += 13) assert.deepEqual(momentumSignalAt(candles, i, p), momentumSignalAt(candles.slice(0, i + 1), i, p));
});

test('uptrend -> long, clipped to max leverage', () => {
  const sig = momentumSignalAt(trend, 59, P);
  assert.equal(sig.signal, 1);
  assert.ok(sig.position > 0 && sig.position <= P.maxLeverage);
});

test('execution lag: first position is not held on the day it is computed', () => {
  const days = momentumBacktest('EURUSD', trend, P);
  assert.equal(days[0].position, 0);
  assert.ok(days[0].gross === 0);
  assert.ok(days[1].position > 0);
  assert.ok(days[1].gross === 0); // traded at close of day 1, earns from day 2
  assert.ok(days[2].gross !== 0);
  const noLag = momentumBacktest('EURUSD', trend, { ...P, executionLagDays: 0 });
  assert.ok(noLag[0].position > 0 && noLag[1].gross !== 0);
});

test('cost is half the round trip per unit of turnover', () => {
  const g = momentumBacktest('EURUSD', trend, P, { costPct: 0 });
  const c = momentumBacktest('EURUSD', trend, P, { costPct: 0.02 });
  for (let k = 0; k < g.length; k++) {
    assert.ok(Math.abs(g[k].ret - c[k].ret - (c[k].turnover * 0.02) / 100 / 2) < 1e-15);
  }
  assert.ok(stats(g).annReturnPct > 0);
});

test('stats: drawdown, t-stat, splitting', () => {
  const days = Array.from({ length: 520 }, (_, i) => ({ t: i * D, ret: i === 100 ? -0.1 : 0.001 }));
  const st = stats(days);
  assert.ok(Math.abs(st.maxDrawdownPct + 10) < 1e-9);
  assert.ok(st.tStat > 0 && Math.abs(st.years - 2) < 1e-9);
  const { inSample, outOfSample } = splitAt(days, new Date(260 * D).toISOString());
  assert.equal(inSample.length, 260);
  assert.equal(outOfSample.length, 260);
});

test('combine averages pairs per day', () => {
  const a = [{ t: 0, ret: 0.02, gross: 0.02, cost: 0, turnover: 1 }];
  const b = [{ t: 0, ret: 0, gross: 0, cost: 0, turnover: 0 }, { t: D, ret: 0.01, gross: 0.01, cost: 0, turnover: 0 }];
  const out = combine({ a, b });
  assert.equal(out.length, 2);
  assert.equal(out[0].ret, 0.01);
  assert.equal(out[1].ret, 0.01);
});

test('rate history is a step function; carry accrues by position', () => {
  const h = parseRatesHistory('date,USD,JPY\n2020-01-01,1.5,-0.1\n2022-06-01,2.0,\n');
  assert.ok(Math.abs(rateDiffAt('USDJPY', h, Date.parse('2021-01-01')) - 1.6) < 1e-12);
  assert.ok(Math.abs(rateDiffAt('USDJPY', h, Date.parse('2023-01-01')) - 2.1) < 1e-12);
  assert.equal(rateDiffAt('USDJPY', h, Date.parse('2019-01-01')), null);
  const flat = series(Array.from({ length: 40 }, (_, i) => 100 * (1 + (i % 2) * 0.001 + i * 0.001)));
  const withCarry = momentumBacktest('USDJPY', flat.map((c) => ({ ...c, t: c.t + Date.parse('2021-01-01') })), P, { ratesHistory: h });
  const without = momentumBacktest('USDJPY', flat, P);
  assert.ok(stats(withCarry).annReturnPct > stats(without).annReturnPct);
});
