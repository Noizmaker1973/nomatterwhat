// Range fade on daily bars: buy near the bottom of the prior N-day range, sell near the top,
// stop a fixed ATR multiple beyond the range edge, target the range midpoint, timeout after
// maxBars. Rules live in config.rangeFade and are fixed before looking at results.
// Same no-lookahead discipline as the breakout scorer: the range and ATR use bars up to the
// signal close, entry is the next bar's open, and a bar touching both stop and target is a stop.
import { atr } from '../indicators.js';
import { roundTripCostPct } from '../costs.js';

export function fadeSignalAt(candles, i, a, p) {
  if (i < p.days - 1 || a[i] == null) return null;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - p.days + 1; j <= i; j++) {
    if (candles[j].h > hi) hi = candles[j].h;
    if (candles[j].l < lo) lo = candles[j].l;
  }
  const width = hi - lo;
  if (width < p.minWidthAtr * a[i]) return null;
  const pos = (candles[i].c - lo) / width;
  const mid = (hi + lo) / 2;
  if (pos <= p.entryZone) return { side: 'long', stop: lo - p.stopAtr * a[i], target: mid, rangeHigh: hi, rangeLow: lo, pos };
  if (pos >= 1 - p.entryZone) return { side: 'short', stop: hi + p.stopAtr * a[i], target: mid, rangeHigh: hi, rangeLow: lo, pos };
  return null;
}

// Walk forward from bar `from` (the entry bar). Returns null if the trade is still open at the end.
export function runFadeTrade(candles, from, sig, maxBars) {
  const dir = sig.side === 'long' ? 1 : -1;
  const entry = candles[from].o;
  // Gapped through a level at the open: no trade (the setup no longer exists).
  if ((entry - sig.stop) * dir <= 0 || (sig.target - entry) * dir <= 0) return { skipped: true };
  const last = from + maxBars - 1;
  for (let i = from; i <= Math.min(last, candles.length - 1); i++) {
    const c = candles[i];
    const hitStop = dir === 1 ? c.l <= sig.stop : c.h >= sig.stop;
    const hitTarget = dir === 1 ? c.h >= sig.target : c.l <= sig.target;
    // A gap through a level at the open fills at the open: worse than the stop, better than the target.
    if (hitStop) return { entry, exit: i > from && (c.o - sig.stop) * dir < 0 ? c.o : sig.stop, outcome: 'stop', bars: i - from + 1 };
    if (hitTarget) return { entry, exit: i > from && (c.o - sig.target) * dir > 0 ? c.o : sig.target, outcome: 'target', bars: i - from + 1 };
  }
  if (last >= candles.length) return null; // unresolved and out of data: still open
  return { entry, exit: candles[last].c, outcome: 'timeout', bars: maxBars };
}

export function rangeFadeBacktest(pair, candles, p, config) {
  const a = atr(candles, p.atrPeriod);
  const trades = [];
  let i = p.days - 1;
  while (i < candles.length - 1) {
    const sig = fadeSignalAt(candles, i, a, p);
    if (!sig) {
      i++;
      continue;
    }
    const res = runFadeTrade(candles, i + 1, sig, p.maxBars);
    if (!res) break;
    if (res.skipped) {
      i++;
      continue;
    }
    const dir = sig.side === 'long' ? 1 : -1;
    const grossPct = ((dir * (res.exit - res.entry)) / res.entry) * 100;
    const feePct = roundTripCostPct(pair, res.entry, config);
    trades.push({
      pair,
      side: sig.side,
      signalTime: new Date(candles[i].t).toISOString(),
      entryTime: new Date(candles[i + 1].t).toISOString(),
      entry: res.entry,
      exit: res.exit,
      outcome: res.outcome,
      bars: res.bars,
      riskPct: ((dir * (res.entry - sig.stop)) / res.entry) * 100,
      rewardPct: ((dir * (sig.target - res.entry)) / res.entry) * 100,
      grossPct,
      feePct,
      netPct: grossPct - feePct,
    });
    i = i + res.bars + 1; // one position per pair: next signal after this trade closes
  }
  return trades;
}
