// Economic calendar as a trade FILTER: no new entries within N minutes of a high-impact
// release for either currency in the pair. Default source is the free ForexFactory weekly
// JSON export (fields: title, country, date, impact). Any file in that shape works.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../config.js';
import { parsePair } from '../pairs.js';

const CAL_PATH = () => join(DATA_DIR, 'calendar.json');

export async function fetchCalendar(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'fx-desk' } });
  if (!res.ok) throw new Error(`Calendar: HTTP ${res.status}`);
  const events = normalizeEvents(await res.json());
  // Merge with what we already have so past weeks stay available for backtests.
  const merged = new Map((loadCalendar() ?? []).map((e) => [`${e.t}-${e.currency}-${e.title}`, e]));
  for (const e of events) merged.set(`${e.t}-${e.currency}-${e.title}`, e);
  const all = [...merged.values()].sort((a, b) => a.t - b.t);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CAL_PATH(), JSON.stringify(all));
  return all;
}

export function normalizeEvents(raw) {
  return raw
    .map((e) => ({ t: Date.parse(e.date), currency: (e.country ?? e.currency ?? '').toUpperCase(), title: e.title, impact: e.impact }))
    .filter((e) => Number.isFinite(e.t));
}

export function loadCalendar() {
  return existsSync(CAL_PATH()) ? JSON.parse(readFileSync(CAL_PATH(), 'utf8')) : null;
}

export function blackoutEvent(pair, t, events, minutes) {
  if (!events) return null;
  const { base, quote } = parsePair(pair);
  const w = minutes * 60e3;
  return events.find((e) => e.impact === 'High' && (e.currency === base || e.currency === quote) && Math.abs(e.t - t) <= w) ?? null;
}
