// Range analysis on daily bars. Two questions:
//  1. Is this pair ranging NOW? (width of the recent range, how choppy the path is)
//  2. If on any past day you had "sold outside" the prior N-day high/low, how often did
//     price get there within the next H days, and how far past it did it go?
// All windows use only bars up to and including day t; outcomes use bars after t.
import { atr } from '../indicators.js';

// Kaufman efficiency ratio: net move / total path. ~0 = chop, 1 = straight line.
export function efficiencyRatio(closes) {
  let path = 0;
  for (let i = 1; i < closes.length; i++) path += Math.abs(closes[i] - closes[i - 1]);
  return path > 0 ? Math.abs(closes[closes.length - 1] - closes[0]) / path : 0;
}

// Lo-MacKinlay variance ratio of log returns. <1 mean-reverting, ~1 random walk, >1 trending.
// Noisy on short windows; read it as a lean, not a verdict.
export function varianceRatio(closes, k) {
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < k * 4) return null;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v1 = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  const rk = [];
  for (let i = k; i <= r.length; i++) {
    let s = 0;
    for (let j = i - k; j < i; j++) s += r[j];
    rk.push(s);
  }
  const vk = rk.reduce((a, b) => a + (b - k * m) ** 2, 0) / (rk.length - 1);
  return v1 > 0 ? vk / (k * v1) : null;
}

export function currentRange(candles, days) {
  if (candles.length < days + 15) return null;
  const win = candles.slice(-days);
  const hi = Math.max(...win.map((c) => c.h));
  const lo = Math.min(...win.map((c) => c.l));
  const last = win[win.length - 1].c;
  const a = atr(candles, 14).at(-1);
  const closes = win.map((c) => c.c);
  return {
    high: hi,
    low: lo,
    last,
    widthPct: ((hi - lo) / ((hi + lo) / 2)) * 100,
    widthAtr: (hi - lo) / a,
    position: hi > lo ? (last - lo) / (hi - lo) : 0.5,
    efficiency: efficiencyRatio(closes),
    varianceRatio: varianceRatio(closes, 5),
  };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo);
}

// For each day t: levels = prior `days` high/low (+/- bufferAtr x ATR). Over the next h days:
//  touch  = traded through either level (would have stressed a short option intraperiod)
//  expire = closed beyond a level on day t+h (a short option there finishes in the money)
//  overshoot = how far past the level the day-t+h close was, in % of price, when it was
export function breachStudy(candles, { days = 60, horizons = [5, 10, 20], bufferAtr = 0, since = -Infinity } = {}) {
  const a = atr(candles, 14);
  const out = {};
  for (const h of horizons) {
    let n = 0;
    let touch = 0;
    let expire = 0;
    let up = 0;
    let down = 0;
    const over = [];
    for (let t = days - 1; t + h < candles.length; t++) {
      if (candles[t].t < since || a[t] == null) continue;
      let hi = -Infinity;
      let lo = Infinity;
      for (let j = t - days + 1; j <= t; j++) {
        if (candles[j].h > hi) hi = candles[j].h;
        if (candles[j].l < lo) lo = candles[j].l;
      }
      const upper = hi + bufferAtr * a[t];
      const lower = lo - bufferAtr * a[t];
      let touched = false;
      for (let j = t + 1; j <= t + h; j++) if (candles[j].h > upper || candles[j].l < lower) touched = true;
      const end = candles[t + h].c;
      n++;
      if (touched) touch++;
      if (end > upper || end < lower) {
        expire++;
        if (end > upper) up++;
        else down++;
        over.push(end > upper ? ((end - upper) / upper) * 100 : ((lower - end) / lower) * 100);
      }
    }
    over.sort((x, y) => x - y);
    out[h] = {
      n,
      touchRate: n ? touch / n : null,
      expireRate: n ? expire / n : null,
      upShare: expire ? up / expire : null,
      downShare: expire ? down / expire : null,
      overshootMedianPct: quantile(over, 0.5),
      overshootP95Pct: quantile(over, 0.95),
      overshootMaxPct: over.length ? over[over.length - 1] : null,
    };
  }
  return out;
}
