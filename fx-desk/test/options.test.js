import { test } from 'node:test';
import assert from 'node:assert/strict';
import { price, greeks, strikeForDelta, normInv, normCdf, impliedVol } from '../src/options/black76.js';
import { buildStrangle, snap, strangleExpiryPnl } from '../src/options/strangle.js';
import { spanEstimate } from '../src/options/margin.js';
import { stressPanel } from '../src/options/stress.js';
import { futureFromSpot, scorePaperStrangle, openPaperStrangle } from '../src/options/paper.js';
import { realizedVol } from '../src/options/vol.js';
import { CONTRACTS, parsePair } from '../src/pairs.js';
import { loadConfig } from '../src/config.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('normal cdf/inverse round-trip', () => {
  for (const p of [0.01, 0.16, 0.5, 0.84, 0.99]) close(normCdf(normInv(p)), p, 1e-6);
});

test('black76 put-call parity and ATM value', () => {
  const [F, K, T, s, r] = [1.1, 1.12, 0.25, 0.08, 0.04];
  close(price('call', F, K, T, s, r) - price('put', F, K, T, s, r), Math.exp(-r * T) * (F - K), 1e-12);
  // ATM approx: 0.4 * F * sigma * sqrt(T)
  close(price('call', 1, 1, 0.25, 0.1, 0), 0.4 * 0.1 * 0.5, 2e-4);
});

test('strike for delta round-trips; IV solver inverts price', () => {
  const [F, T, s] = [1.08, 30 / 365, 0.075];
  const Kc = strikeForDelta('call', F, T, s, 0.16);
  const Kp = strikeForDelta('put', F, T, s, 0.16);
  close(greeks('call', F, Kc, T, s).delta, 0.16, 1e-6);
  close(greeks('put', F, Kp, T, s).delta, -0.16, 1e-6);
  assert.ok(Kc > F && Kp < F);
  close(impliedVol('call', price('call', F, Kc, T, s), F, Kc, T), s, 1e-6);
});

test('strikes snap outward to the grid', () => {
  assert.equal(snap(1.1012, 0.005, 'up'), 1.105);
  assert.equal(snap(1.0588, 0.005, 'down'), 1.055);
  assert.equal(snap(1.105, 0.005, 'up'), 1.105);
});

test('strangle: credit positive, short vega, max profit is the credit, loss grows with move', () => {
  const s = buildStrangle({ F: 1.08, ivPct: 7.5, dte: 30, delta: 0.16, contract: CONTRACTS['6E'] });
  assert.ok(s.creditUsd > 0);
  assert.ok(s.netVega < 0 && s.netThetaUsd > 0);
  close(strangleExpiryPnl(s, CONTRACTS['6E'], 1.08), s.creditUsd, 1e-6);
  assert.ok(strangleExpiryPnl(s, CONTRACTS['6E'], 1.2) < strangleExpiryPnl(s, CONTRACTS['6E'], 1.15));
  assert.ok(s.popOtm > 0.5 && s.popOtm < 1);
});

test('margin and stress: margin > 0, rises under stress, 30% gap loses many credits', () => {
  const cfg = loadConfig().options;
  const s = buildStrangle({ F: 1.08, ivPct: 7.5, dte: 30, delta: 0.16, contract: CONTRACTS['6E'] });
  const m = spanEstimate(s, CONTRACTS['6E']);
  assert.ok(m.marginUsd > 0);
  const p = stressPanel(s, CONTRACTS['6E'], cfg);
  assert.ok(p.stressedMarginUsd > m.marginUsd);
  const snb = p.rows.find((r) => r.scenario.startsWith('SNB') && r.scenario.endsWith('down'));
  assert.ok(snb.creditsLost > 50);
});

test('USD-base pairs map to inverted futures', () => {
  const info = parsePair('USDJPY');
  assert.equal(info.future, '6J');
  close(futureFromSpot(info, 150, 0, { USD: 4, JPY: 0.5 }), 1 / 150, 1e-15);
  assert.ok(futureFromSpot(info, 150, 1, { USD: 4, JPY: 0.5 }) > 1 / 150); // USD rates higher -> future at premium
  assert.equal(parsePair('EURGBP').future, null);
});

test('paper strangle settles at expiry; quiet market expires OTM for the credit', () => {
  const config = loadConfig();
  const rates = { rates: { USD: 4, EUR: 2 } };
  const t0 = Date.UTC(2026, 0, 1);
  const s = openPaperStrangle({ pair: 'EURUSD', spot: 1.08, ivPct: 7.5, dte: 30, delta: 0.16, config, rates, now: t0 });
  const daily = Array.from({ length: 32 }, (_, i) => ({ t: t0 + i * 86400e3, o: 1.08, h: 1.081, l: 1.079, c: 1.08 }));
  const r = scorePaperStrangle(s, daily, config, rates);
  assert.equal(r.expiredOtm, true);
  close(r.heldToExpiryPnlUsd, s.creditUsd, 1e-6);
  assert.equal(r.stoppedAt, null);
  assert.equal(scorePaperStrangle(s, daily.slice(0, 10), config, rates), null);
});

test('realized vol of a constant-return series is ~0; scales with returns', () => {
  const flat = Array.from({ length: 30 }, (_, i) => ({ c: 1 * 1.001 ** i, h: 1, l: 1 }));
  close(realizedVol(flat, 20), 0, 1e-9);
  const zig = Array.from({ length: 30 }, (_, i) => ({ c: i % 2 ? 1.01 : 1 }));
  assert.ok(realizedVol(zig, 20) > 0.1);
});
