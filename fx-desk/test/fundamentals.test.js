import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carry } from '../src/fundamentals/rates.js';
import { cotIndex, parseCotRows } from '../src/fundamentals/cot.js';
import { blackoutEvent, normalizeEvents } from '../src/fundamentals/calendar.js';
import { makeFilter } from '../src/fundamentals/filter.js';
import { loadConfig } from '../src/config.js';

const rates = { asOf: '2026-10-01', rates: { USD: 4, EUR: 2, JPY: 0.5 } };

test('carry sign and staleness', () => {
  const c = carry('USDJPY', rates, { now: Date.parse('2026-10-10') });
  assert.equal(c.diffPct, 3.5);
  assert.equal(c.stale, false);
  assert.equal(carry('EURUSD', { ...rates, asOf: null }).stale, true);
});

test('COT parse and index', () => {
  const raw = Array.from({ length: 30 }, (_, i) => ({
    report_date_as_yyyy_mm_dd: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000`,
    noncomm_positions_long_all: String(1000 + i * 10),
    noncomm_positions_short_all: '1000',
    open_interest_all: '10000',
  }));
  const rows = parseCotRows(raw.reverse());
  assert.equal(rows[0].date, '2026-01-01');
  assert.equal(cotIndex(rows).index, 100);
  assert.equal(cotIndex(rows.slice(0, 5)), null);
});

test('calendar blackout matches either currency, high impact only', () => {
  const ev = normalizeEvents([
    { title: 'NFP', country: 'USD', date: '2026-10-02T08:30:00-04:00', impact: 'High' },
    { title: 'Minor', country: 'EUR', date: '2026-10-02T12:00:00Z', impact: 'Low' },
  ]);
  const nfp = Date.parse('2026-10-02T12:30:00Z');
  assert.equal(blackoutEvent('EURUSD', nfp + 30 * 60e3, ev, 60).title, 'NFP');
  assert.equal(blackoutEvent('EURUSD', nfp + 90 * 60e3, ev, 60), null);
  assert.equal(blackoutEvent('EURUSD', Date.parse('2026-10-02T12:00:00Z') + 60e3 * 200, ev, 60), null);
});

test('filter blocks on blackout, tags carry and crowding', () => {
  const config = loadConfig();
  const t = Date.parse('2026-10-02T12:30:00Z');
  const calendar = normalizeEvents([{ title: 'NFP', country: 'USD', date: '2026-10-02T12:30:00Z', impact: 'High' }]);
  const filter = makeFilter(config, { rates, calendar, positioning: () => ({ pairIndex: 95 }) });
  const v = filter({ pair: 'EURUSD', side: 'long', t });
  assert.equal(v.allowed, false);
  assert.equal(v.tags.carryAligned, false);
  assert.equal(v.tags.crowded, true);
  const later = filter({ pair: 'EURUSD', side: 'short', t: t + 5 * 3600e3 });
  assert.equal(later.allowed, true);
  assert.equal(later.tags.carryAligned, true);
});
