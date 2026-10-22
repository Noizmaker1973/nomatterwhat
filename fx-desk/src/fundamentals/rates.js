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
