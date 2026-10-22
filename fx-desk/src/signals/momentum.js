// Time-series momentum on daily bars, vol-targeted, rebalanced on a fixed schedule.
// Unlike the breakout detector this is a position you always hold (long, short or flat),
// so it is scored as a daily return series, not as discrete trades.
//
// Rule (fixed in config.momentum before looking at results):
//   signal  = mean of sign(return over each lookback)            in [-1, 1]
//             (+ carryWeight * sign(rate differential), clipped, if a rate history exists)
//   size    = signal * targetVol / realized vol, clipped to +-maxLeverage
//   timing  = computed at a rebalance-day close, traded executionLagDays later
//   cost    = |change in position| * half the round-trip cost (one side of the spread)
import { rateDiffAt } from '../fundamentals/rates.js';

const ANNUAL = 260;

function realizedVolAt(closes, i, n) {
  if (i < n) return null;
  let s = 0;
  let s2 = 0;
  for (let j = i - n + 1; j <= i; j++) {
    const r = Math.log(closes[j] / closes[j - 1]);
    s += r;
    s2 += r * r;
  }
  const m = s / n;
  return Math.sqrt(Math.max(s2 / n - m * m, 0) * ANNUAL);
}

export function momentumSignalAt(candles, i, p, ratesHistory = null, pair = null) {
  const closes = candles.map((c) => c.c);
  const maxLb = Math.max(...p.lookbacks);
  if (i < Math.max(maxLb, p.volWindow)) return null;
  const parts = p.lookbacks.map((lb) => Math.sign(closes[i] / closes[i - lb] - 1));
  let signal = parts.reduce((a, b) => a + b, 0) / parts.length;
  let carryDiff = null;
  if (ratesHistory && p.carryWeight) {
    carryDiff = rateDiffAt(pair, ratesHistory, candles[i].t);
    if (carryDiff != null) signal = Math.max(-1, Math.min(1, signal + p.carryWeight * Math.sign(carryDiff)));
  }
  const vol = realizedVolAt(closes, i, p.volWindow);
  const raw = vol > 0 ? (signal * p.targetVol) / vol : 0;
  const position = Math.max(-p.maxLeverage, Math.min(p.maxLeverage, raw));
  return { t: candles[i].t, price: closes[i], parts, signal, vol, position, carryDiff };
}

// Daily return series for one pair. costPct is the full round-trip cost in percent of price.
export function momentumBacktest(pair, candles, p, { costPct = 0, ratesHistory = null } = {}) {
  const closes = candles.map((c) => c.c);
  const start = Math.max(...p.lookbacks, p.volWindow);
  const days = [];
  let pos = 0;
  const pending = []; // [{ at: index, position }]; a trade at close i earns from i+1
  for (let i = start; i < candles.length; i++) {
    const ret = closes[i] / closes[i - 1] - 1;
    let pnl = pos * ret;
    if (ratesHistory) {
      const diff = rateDiffAt(pair, ratesHistory, candles[i].t);
      if (diff != null) pnl += (pos * diff) / 100 / ANNUAL; // spot returns exclude interest; add it back
    }
    if ((i - start) % p.rebalanceDays === 0) {
      const sig = momentumSignalAt(candles, i, p, ratesHistory, pair);
      if (sig) pending.push({ at: i + p.executionLagDays, position: sig.position });
    }
    let turnover = 0;
    while (pending.length && pending[0].at <= i) {
      const next = pending.shift().position;
      turnover += Math.abs(next - pos);
      pos = next;
    }
    const cost = (turnover * costPct) / 100 / 2;
    days.push({ t: candles[i].t, ret: pnl - cost, gross: pnl, cost, turnover, position: pos });
  }
  return days;
}

// Equal-weight portfolio: average of the pairs that have a return that day.
export function combine(seriesByPair) {
  const byDay = new Map();
  for (const series of Object.values(seriesByPair)) {
    for (const d of series) {
      const key = new Date(d.t).toISOString().slice(0, 10);
      const cur = byDay.get(key) ?? { t: Date.parse(key), ret: 0, gross: 0, cost: 0, turnover: 0, n: 0 };
      cur.ret += d.ret;
      cur.gross += d.gross;
      cur.cost += d.cost;
      cur.turnover += d.turnover;
      cur.n++;
      byDay.set(key, cur);
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.t - b.t)
    .map((d) => ({ t: d.t, ret: d.ret / d.n, gross: d.gross / d.n, cost: d.cost / d.n, turnover: d.turnover / d.n }));
}

export function stats(days, key = 'ret') {
  const n = days.length;
  if (n < 20) return { n };
  const r = days.map((d) => d[key]);
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  for (const x of r) {
    eq *= 1 + x;
    peak = Math.max(peak, eq);
    maxDd = Math.min(maxDd, eq / peak - 1);
  }
  const years = n / ANNUAL;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(ANNUAL) : 0;
  return {
    n,
    years,
    annReturnPct: mean * ANNUAL * 100,
    cagrPct: (eq ** (1 / years) - 1) * 100,
    annVolPct: sd * Math.sqrt(ANNUAL) * 100,
    sharpe,
    tStat: sharpe * Math.sqrt(years),
    maxDrawdownPct: maxDd * 100,
    turnoverPerYear: days.reduce((a, d) => a + (d.turnover ?? 0), 0) / years,
    costDragPctPerYear: (days.reduce((a, d) => a + (d.cost ?? 0), 0) / years) * 100,
  };
}

export function splitAt(days, isoDate) {
  const cut = Date.parse(isoDate);
  return { inSample: days.filter((d) => d.t < cut), outOfSample: days.filter((d) => d.t >= cut) };
}
