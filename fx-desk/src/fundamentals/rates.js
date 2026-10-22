import { parsePair } from '../pairs.js';

// Policy-rate differential of base minus quote, in percent. Positive = long earns carry.
export function carry(pair, ratesFile, { maxAgeDays = 45, now = Date.now() } = {}) {
  const { base, quote } = parsePair(pair);
  const r = ratesFile.rates;
  if (r[base] == null || r[quote] == null) return null;
  const ageDays = ratesFile.asOf ? (now - Date.parse(ratesFile.asOf)) / 86400e3 : null;
  return {
    baseRate: r[base],
    quoteRate: r[quote],
    diffPct: r[base] - r[quote],
    stale: ageDays == null || ageDays > maxAgeDays,
    asOf: ratesFile.asOf,
  };
}

// Optional policy-rate HISTORY for backtests: config/rates-history.csv with a header
// `date,USD,EUR,...` and one row per rate change (or per month). Each row holds until the next.
// Not shipped: only add data you have verified from the central banks.
export function parseRatesHistory(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((s) => s.trim().toUpperCase());
  return lines
    .slice(1)
    .map((line) => {
      const f = line.split(',');
      const rates = {};
      header.slice(1).forEach((ccy, k) => {
        if (f[k + 1] !== undefined && f[k + 1].trim() !== '') rates[ccy] = Number(f[k + 1]);
      });
      return { t: Date.parse(f[0].trim()), rates };
    })
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
}

export function rateDiffAt(pair, history, t) {
  const { base, quote } = parsePair(pair);
  let b = null;
  let q = null;
  for (const row of history) {
    if (row.t > t) break;
    if (row.rates[base] != null) b = row.rates[base];
    if (row.rates[quote] != null) q = row.rates[quote];
  }
  return b == null || q == null ? null : b - q;
}
