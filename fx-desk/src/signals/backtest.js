// Walk forward bar by bar: detect with only data up to bar i, score with bars after i.
// One position per pair at a time, so overlapping signals don't inflate the count.
import { detectAt, prepare } from './breakout.js';
import { scoreSignal } from './score.js';
import { roundTripCostPct } from '../costs.js';

export function backtestPair(pair, candles, config, filter = null) {
  const p = config.strategy;
  const tf = config.timeframe;
  const ind = prepare(candles, p);
  const outcomes = [];
  const blocked = [];
  let busyUntil = -Infinity;
  const warmup = Math.max(p.squeezeLookback + p.squeezeWindow, p.donchianPeriod, p.trendEma || 0) + 1;
  for (let i = warmup; i < candles.length - 1; i++) {
    if (candles[i].t < busyUntil) continue;
    const sig = detectAt(candles, i, ind, p, { pair, tf });
    if (!sig) continue;
    const fee = roundTripCostPct(pair, sig.refPrice, config);
    const res = scoreSignal(sig, candles.slice(i + 1, i + 1 + p.maxBars), fee);
    if (!res) continue;
    const verdict = filter ? filter(sig) : null;
    if (verdict && !verdict.allowed) {
      blocked.push({ ...res, reasons: verdict.reasons });
      continue;
    }
    outcomes.push(res);
    busyUntil = Date.parse(res.entryTime) + res.bars * (candles[1].t - candles[0].t);
  }
  return { outcomes, blocked };
}
