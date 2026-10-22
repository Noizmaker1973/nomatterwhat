// Deterministic GBM with volatility regimes (quiet stretches then bursts) so the
// compression -> breakout logic has something to find. For tests and demos ONLY:
// results on synthetic data say nothing about real-market edge.
import { tfMs } from './resample.js';

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = { EURUSD: 1.08, GBPUSD: 1.27, USDJPY: 150, AUDUSD: 0.66, USDCAD: 1.36, USDCHF: 0.88 };

export function synthetic(pair, tf, { bars = 3000, seed = 42, annualVol = 0.08, end = Date.UTC(2026, 0, 1) } = {}) {
  const rand = mulberry32(seed + [...pair].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const ms = tfMs(tf);
  const dt = ms / (365 * 24 * 3600e3);
  let price = START[pair] ?? 1;
  let regime = 1;
  const out = [];
  for (let i = 0; i < bars; i++) {
    if (rand() < 0.02) regime = rand() < 0.5 ? 0.4 : 1.8;
    const sigma = annualVol * regime * Math.sqrt(dt);
    const o = price;
    let h = o;
    let l = o;
    for (let s = 0; s < 4; s++) {
      price *= Math.exp(sigma * 0.5 * gauss());
      h = Math.max(h, price);
      l = Math.min(l, price);
    }
    out.push({ t: end - (bars - i) * ms, o, h, l, c: price, v: 0 });
  }
  return out;
}
