// CFTC Commitments of Traders (Legacy, futures only) via the public Socrata API, no key.
// The COT index is where net non-commercial (speculator) positioning sits within its own
// 3-year range, 0..100. Extremes flag crowding: a trade WITH a crowded side has less fuel.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';
import { parsePair } from '../pairs.js';

export const COT_CODES = { EUR: '099741', GBP: '096742', JPY: '097741', CHF: '092741', CAD: '090741', AUD: '232741', NZD: '112741' };

export async function fetchCot(ccy, weeks = 156) {
  const code = COT_CODES[ccy];
  if (!code) throw new Error(`No COT code for ${ccy}`);
  const url =
    'https://publicreporting.cftc.gov/resource/6dca-aqww.json' +
    `?cftc_contract_market_code=${code}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=${weeks}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CFTC ${ccy}: HTTP ${res.status}`);
  const rows = parseCotRows(await res.json());
  mkdirSync(join(DATA_DIR, 'cot'), { recursive: true });
  writeFileSync(join(DATA_DIR, 'cot', `${ccy}.json`), JSON.stringify(rows));
  return rows;
}

export function parseCotRows(raw) {
  return raw
    .map((r) => {
      const long = +r.noncomm_positions_long_all;
      const short = +r.noncomm_positions_short_all;
      const oi = +r.open_interest_all;
      return { date: r.report_date_as_yyyy_mm_dd.slice(0, 10), net: long - short, netPctOi: oi ? ((long - short) / oi) * 100 : 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function loadCot(ccy) {
  const p = join(DATA_DIR, 'cot', `${ccy}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function cotIndex(rows) {
  if (!rows || rows.length < 26) return null;
  const nets = rows.map((r) => r.net);
  const min = Math.min(...nets);
  const max = Math.max(...nets);
  const last = rows[rows.length - 1];
  return { date: last.date, net: last.net, netPctOi: last.netPctOi, index: max > min ? ((last.net - min) / (max - min)) * 100 : 50 };
}

// Positioning read for a spot pair. For EURUSD, specs long EUR futures = long the pair.
// For USDJPY, specs long JPY futures = short the pair, so the index is inverted.
export function pairPositioning(pair) {
  const info = parsePair(pair);
  const ccy = info.base === 'USD' ? info.quote : info.quote === 'USD' ? info.base : null;
  if (!ccy) return null;
  const idx = cotIndex(loadCot(ccy));
  if (!idx) return null;
  return { currency: ccy, ...idx, pairIndex: info.base === 'USD' ? 100 - idx.index : idx.index };
}
