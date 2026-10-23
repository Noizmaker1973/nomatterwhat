import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fadeSignalAt, runFadeTrade, rangeFadeBacktest } from '../src/signals/rangeFade.js';
import { scoreSignal } from '../src/signals/score.js';
import { atr } from '../src/indicators.js';
import { loadConfig } from '../src/config.js';

const D = 86400e3;
const P = { days: 20, entryZone: 0.15, minWidthAtr: 2, stopAtr: 1, maxBars: 5, atrPeriod: 5 };
// Oscillates between ~1.00 and ~1.10, ending at the bottom.
const osc = Array.from({ length: 41 }, (_, i) => {
  const c = 1.05 + 0.05 * Math.cos((i * Math.PI) / 10);
  return { t: i * D, o: c, h: c + 0.002, l: c - 0.002, c };
});

test('fade signal: long at the bottom, stop below the range, target the midpoint', () => {
  const i = 30; // cos(3pi) = -1 -> bottom
  const sig = fadeSignalAt(osc, i, atr(osc, P.atrPeriod), P);
  assert.equal(sig.side, 'long');
  assert.ok(sig.stop < sig.rangeLow);
  assert.ok(Math.abs(sig.target - (sig.rangeHigh + sig.rangeLow) / 2) < 1e-12);
  assert.equal(fadeSignalAt(osc, 25, atr(osc, P.atrPeriod), P), null); // mid-range: nothing
});

test('narrow range (below minWidthAtr) gives no signal', () => {
  const sig = fadeSignalAt(osc, 30, atr(osc, P.atrPeriod), { ...P, minWidthAtr: 1000 });
  assert.equal(sig, null);
});

const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const longSig = { side: 'long', stop: 0.99, target: 1.05 };

test('trade: target, stop, timeout, open-trade and gap handling', () => {
  assert.equal(runFadeTrade([bar(0, 1, 1.06, 1, 1.05)], 0, longSig, 3).outcome, 'target');
  assert.equal(runFadeTrade([bar(0, 1, 1.06, 0.98, 1)], 0, longSig, 3).outcome, 'stop'); // both in one bar -> stop
  const flat = [0, 1, 2].map((i) => bar(i, 1, 1.01, 0.995, 1.002));
  assert.equal(runFadeTrade(flat, 0, longSig, 3).outcome, 'timeout');
  assert.equal(runFadeTrade(flat, 0, longSig, 4), null);
  assert.equal(runFadeTrade([bar(0, 0.98, 1, 0.97, 0.99)], 0, longSig, 3).skipped, true); // opened below stop
  const gap = runFadeTrade([bar(0, 1, 1.01, 0.995, 1), bar(1, 0.97, 0.98, 0.96, 0.97)], 0, longSig, 3);
  assert.equal(gap.exit, 0.97); // gapped through the stop: filled at the open, not 0.99
});

test('breakout scorer also fills stop gaps at the open', () => {
  const sig = { id: 'x', pair: 'EURUSD', side: 'long', t: 0, stopDist: 0.01, targetDist: 0.02, maxBars: 3 };
  const r = scoreSignal(sig, [bar(D, 1, 1.005, 0.995, 1), bar(2 * D, 0.97, 0.975, 0.96, 0.97)], 0);
  assert.equal(r.outcome, 'stop');
  assert.equal(r.exit, 0.97);
});

test('backtest: trades do not overlap and costs only reduce returns', () => {
  const cfg = loadConfig();
  const long = Array.from({ length: 600 }, (_, i) => {
    const c = 1.05 + 0.05 * Math.sin(i / 7) + 0.01 * Math.sin(i / 2.3);
    return { t: i * D, o: c, h: c + 0.003, l: c - 0.003, c };
  });
  const trades = rangeFadeBacktest('EURUSD', long, { ...cfg.rangeFade, days: 30, minWidthAtr: 2 }, cfg);
  assert.ok(trades.length > 5);
  for (let k = 1; k < trades.length; k++) assert.ok(Date.parse(trades[k].entryTime) > Date.parse(trades[k - 1].entryTime) + (trades[k - 1].bars - 1) * D);
  for (const t of trades) assert.ok(t.netPct < t.grossPct);
});
