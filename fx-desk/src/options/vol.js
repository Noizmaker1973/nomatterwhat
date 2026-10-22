import { appendJsonl, readJsonl } from '../journal.js';
import { percentileRank } from '../indicators.js';

const ANNUAL = 260; // FX trading days per year

// Close-to-close realized vol over the last n daily candles, annualized, as a decimal.
export function realizedVol(daily, n) {
  if (daily.length < n + 1) return null;
  const rets = [];
  for (let i = daily.length - n; i < daily.length; i++) rets.push(Math.log(daily[i].c / daily[i - 1].c));
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * ANNUAL);
}

// Parkinson high-low estimator; less noisy than close-to-close on the same window.
export function parkinsonVol(daily, n) {
  if (daily.length < n) return null;
  const k = 1 / (4 * Math.log(2));
  let s = 0;
  for (let i = daily.length - n; i < daily.length; i++) s += Math.log(daily[i].h / daily[i].l) ** 2;
  return Math.sqrt((k * s * ANNUAL) / n);
}

// Rolling 20d RV over the history, and where today's sits; context when there is no IV history.
export function rvPercentile(daily, n = 20, lookback = 252) {
  const series = [];
  for (let end = Math.max(n + 1, daily.length - lookback); end <= daily.length; end++) {
    const rv = realizedVol(daily.slice(0, end), n);
    if (rv != null) series.push(rv);
  }
  if (series.length < 20) return null;
  const cur = series[series.length - 1];
  return { current: cur, percentile: percentileRank(series, cur), min: Math.min(...series), max: Math.max(...series) };
}

// IV history is whatever you log (from your broker or CME CVOL) via `options log-iv`.
export function logIv(symbol, ivPct, date = new Date().toISOString().slice(0, 10)) {
  appendJsonl(`iv/${symbol}.jsonl`, { date, iv: ivPct });
}

export function ivRank(symbol, ivPct, lookback = 252) {
  const byDate = new Map(readJsonl(`iv/${symbol}.jsonl`).map((r) => [r.date, r.iv]));
  const hist = [...byDate.entries()].sort().slice(-lookback).map(([, v]) => v);
  if (hist.length < 20) return { n: hist.length, rank: null, percentile: null };
  const min = Math.min(...hist);
  const max = Math.max(...hist);
  return { n: hist.length, min, max, rank: max > min ? (ivPct - min) / (max - min) : null, percentile: percentileRank(hist, ivPct) };
}
