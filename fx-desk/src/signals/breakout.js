// Compression -> breakout. A Bollinger squeeze (band width in the bottom percentile of
// its own recent history) for enough of the recent bars, then a close outside the
// prior Donchian channel. Stop/target are ATR multiples from entry.
import { atr, bollinger, donchian, ema, percentileRank } from '../indicators.js';

export function prepare(candles, p) {
  const closes = candles.map((c) => c.c);
  return {
    bb: bollinger(closes, p.bbPeriod, p.bbK),
    atr: atr(candles, p.atrPeriod),
    dc: donchian(candles, p.donchianPeriod),
    trend: p.trendEma ? ema(closes, p.trendEma) : null,
  };
}

function inSqueeze(ind, i, p) {
  if (i < p.squeezeLookback || !ind.bb[i]) return false;
  const hist = [];
  for (let j = i - p.squeezeLookback; j < i; j++) if (ind.bb[j]) hist.push(ind.bb[j].width);
  return percentileRank(hist, ind.bb[i].width) <= p.squeezePercentile;
}

// Evaluate bar i (which must be closed). Returns a signal object or null.
export function detectAt(candles, i, ind, p, meta) {
  const c = candles[i];
  const dc = ind.dc[i];
  const a = ind.atr[i];
  if (!dc || !a) return null;
  let squeezeBars = 0;
  for (let j = Math.max(0, i - p.squeezeWindow); j < i; j++) if (inSqueeze(ind, j, p)) squeezeBars++;
  if (squeezeBars < p.minSqueezeBars) return null;

  let side = null;
  if (c.c > dc.high) side = 'long';
  else if (c.c < dc.low) side = 'short';
  if (!side) return null;
  if (ind.trend) {
    const tr = ind.trend[i];
    if (tr == null || (side === 'long' && c.c < tr) || (side === 'short' && c.c > tr)) return null;
  }
  const dir = side === 'long' ? 1 : -1;
  return {
    id: `${meta.pair}-${meta.tf}-${c.t}`,
    pair: meta.pair,
    tf: meta.tf,
    t: c.t,
    time: new Date(c.t).toISOString(),
    side,
    refPrice: c.c,
    atr: a,
    stopDist: p.stopAtr * a,
    targetDist: p.targetAtr * a,
    stopPct: ((p.stopAtr * a) / c.c) * 100,
    targetPct: ((p.targetAtr * a) / c.c) * 100,
    maxBars: p.maxBars,
    squeezeBars,
    breakoutLevel: dir === 1 ? dc.high : dc.low,
  };
}

export function detectLatest(candles, p, meta) {
  const ind = prepare(candles, p);
  return detectAt(candles, candles.length - 1, ind, p, meta);
}
