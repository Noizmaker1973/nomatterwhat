import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSignal, summarize, withFee } from '../src/signals/score.js';
import { roundTripCostPct } from '../src/costs.js';
import { backtestPair } from '../src/signals/backtest.js';
import { detectAt, prepare } from '../src/signals/breakout.js';
import { synthetic } from '../src/data/synthetic.js';
import { resample, closedOnly } from '../src/data/resample.js';
import { parseCsv } from '../src/data/csv.js';
import { loadConfig } from '../src/config.js';

const H = 3600e3;
const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const sig = { id: 'x', pair: 'EURUSD', side: 'long', t: 0, stopDist: 0.001, targetDist: 0.002, maxBars: 3 };

test('entry is next bar open; target hit', () => {
  const r = scoreSignal(sig, [bar(0, 1, 1, 1, 1), bar(H, 1.1, 1.1005, 1.0995, 1.1), bar(2 * H, 1.1, 1.1025, 1.1, 1.102)], 0.01);
  assert.equal(r.entry, 1.1);
  assert.equal(r.outcome, 'target');
  assert.ok(Math.abs(r.grossPct - (0.002 / 1.1) * 100) < 1e-9);
  assert.ok(Math.abs(r.netPct - (r.grossPct - 0.01)) < 1e-12);
});

test('stop and target in the same bar counts as stop', () => {
  const r = scoreSignal(sig, [bar(H, 1, 1.01, 0.99, 1)], 0);
  assert.equal(r.outcome, 'stop');
});

test('short side and timeout; unresolved returns null', () => {
  const s = { ...sig, side: 'short' };
  const flat = [1, 2, 3].map((i) => bar(i * H, 1, 1.0005, 0.9995, 0.9998));
  const r = scoreSignal(s, flat, 0);
  assert.equal(r.outcome, 'timeout');
  assert.ok(r.grossPct > 0);
  assert.equal(scoreSignal(s, flat.slice(0, 2), 0), null);
});

test('summarize and withFee', () => {
  const outs = [{ grossPct: 0.3, netPct: 0.3, outcome: 'target' }, { grossPct: -0.1, netPct: -0.1, outcome: 'stop' }];
  const s = summarize(outs);
  assert.equal(s.winRate, 0.5);
  assert.ok(Math.abs(s.profitFactor - 3) < 1e-12);
  assert.equal(summarize(withFee(outs, 0.3)).winRate, 0);
});

test('FX round-trip cost: 1 pip on EURUSD ~ 0.009%, JPY pip size handled', () => {
  const cfg = { pairs: { EURUSD: { spreadPips: 1 }, USDJPY: { spreadPips: 1 } }, costs: { slippagePips: 0 } };
  assert.ok(Math.abs(roundTripCostPct('EURUSD', 1.08, cfg) - 0.0001 / 1.08 * 100) < 1e-12);
  assert.ok(Math.abs(roundTripCostPct('USDJPY', 150, cfg) - 0.01 / 150 * 100) < 1e-12);
});

test('detector uses no future data: result at bar i is unchanged by appending bars', () => {
  const cfg = loadConfig();
  const candles = synthetic('EURUSD', '1h', { bars: 2000 });
  const meta = { pair: 'EURUSD', tf: '1h' };
  const indFull = prepare(candles, cfg.strategy);
  for (let i = 300; i < 1500; i += 7) {
    const a = detectAt(candles, i, indFull, cfg.strategy, meta);
    const cut = candles.slice(0, i + 1);
    const b = detectAt(cut, i, prepare(cut, cfg.strategy), cfg.strategy, meta);
    assert.deepEqual(a, b);
  }
});

test('backtest runs, fees only lower results, no overlapping trades', () => {
  const cfg = loadConfig();
  const candles = synthetic('GBPUSD', '1h', { bars: 4000 });
  const { outcomes } = backtestPair('GBPUSD', candles, cfg);
  assert.ok(outcomes.length > 10);
  for (const o of outcomes) assert.ok(o.netPct < o.grossPct);
  for (let i = 1; i < outcomes.length; i++) assert.ok(Date.parse(outcomes[i].entryTime) > Date.parse(outcomes[i - 1].entryTime));
});

test('resample to 4h and drop unclosed bar', () => {
  const hourly = Array.from({ length: 8 }, (_, i) => bar(i * H, i, i + 0.5, i - 0.5, i + 0.1));
  const four = resample(hourly, '4h');
  assert.equal(four.length, 2);
  assert.deepEqual(four[0], { t: 0, o: 0, h: 3.5, l: -0.5, c: 3.1, v: 0 });
  assert.equal(closedOnly(four, '4h', 8 * H - 1).length, 1);
});

test('csv parser handles ISO and epoch seconds', () => {
  const c = parseCsv('time,open,high,low,close\n1700000000,1,2,0.5,1.5\n2023-11-14T23:00:00Z,1,2,0.5,1.4\n');
  assert.equal(c.length, 2);
  assert.equal(c[0].t, 1700000000000);
});
