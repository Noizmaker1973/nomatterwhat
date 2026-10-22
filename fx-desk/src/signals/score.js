// Score a signal against the candles that came AFTER it. Entry is the next bar's open
// (no fill at the signal close you could not have traded). If stop and target are both
// inside one bar we assume the stop hit first.
export function scoreSignal(signal, candles, feePct) {
  const start = candles.findIndex((c) => c.t > signal.t);
  if (start < 0) return null;
  const dir = signal.side === 'long' ? 1 : -1;
  const entry = candles[start].o;
  const stop = entry - dir * signal.stopDist;
  const target = entry + dir * signal.targetDist;
  const last = Math.min(candles.length - 1, start + signal.maxBars - 1);
  let exit = null;
  let outcome = null;
  let bars = 0;
  for (let i = start; i <= last; i++) {
    const c = candles[i];
    bars = i - start + 1;
    const hitStop = dir === 1 ? c.l <= stop : c.h >= stop;
    const hitTarget = dir === 1 ? c.h >= target : c.l <= target;
    if (hitStop) {
      exit = stop;
      outcome = 'stop';
      break;
    }
    if (hitTarget) {
      exit = target;
      outcome = 'target';
      break;
    }
  }
  if (!outcome) {
    if (last - start + 1 < signal.maxBars) return null; // still open
    exit = candles[last].c;
    outcome = 'timeout';
  }
  const grossPct = ((dir * (exit - entry)) / entry) * 100;
  return {
    id: signal.id,
    pair: signal.pair,
    side: signal.side,
    entryTime: new Date(candles[start].t).toISOString(),
    entry,
    exit,
    outcome,
    bars,
    grossPct,
    feePct,
    netPct: grossPct - feePct,
  };
}

export function summarize(outcomes, key = 'netPct') {
  const n = outcomes.length;
  if (!n) return { n: 0 };
  const rets = outcomes.map((o) => o[key]);
  const wins = rets.filter((r) => r > 0);
  const losses = rets.filter((r) => r <= 0);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  return {
    n,
    winRate: wins.length / n,
    targetHitRate: outcomes.filter((o) => o.outcome === 'target').length / n,
    avgWinPct: wins.length ? grossWin / wins.length : 0,
    avgLossPct: losses.length ? -grossLoss / losses.length : 0,
    expectancyPct: sum(rets) / n,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : 0,
    totalPct: sum(rets),
  };
}

// Re-score the same gross results under a different round-trip fee.
export function withFee(outcomes, feePct) {
  return outcomes.map((o) => ({ ...o, feePct, netPct: o.grossPct - feePct }));
}
