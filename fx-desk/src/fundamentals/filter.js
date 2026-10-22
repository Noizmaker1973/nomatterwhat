// Fundamentals as a filter on technical signals, never a signal source.
// Returns { allowed, reasons, tags }. Blocked signals are still logged (with blocked=true)
// so scoring can tell you whether the filter is earning its keep.
import { carry } from './rates.js';
import { pairPositioning } from './cot.js';
import { blackoutEvent } from './calendar.js';

export function makeFilter(config, { rates, calendar, positioning = pairPositioning } = {}) {
  const f = config.fundamentals;
  const cache = new Map();
  const pos = (pair) => {
    if (!cache.has(pair)) cache.set(pair, positioning(pair));
    return cache.get(pair);
  };
  return (signal) => {
    const reasons = [];
    const tags = {};
    const dir = signal.side === 'long' ? 1 : -1;

    const ev = blackoutEvent(signal.pair, signal.t, calendar, f.calendarBlackoutMinutes);
    if (ev) {
      tags.blackout = `${ev.currency} ${ev.title} @ ${new Date(ev.t).toISOString()}`;
      if (f.blockOnBlackout) reasons.push(`news blackout: ${tags.blackout}`);
    }

    if (rates) {
      const c = carry(signal.pair, rates, { maxAgeDays: f.ratesMaxAgeDays });
      if (c) {
        tags.carryDiffPct = c.diffPct;
        tags.carryAligned = Math.sign(c.diffPct) === dir || c.diffPct === 0;
        if (c.stale) tags.ratesStale = true;
        if (f.requireCarryAligned && !tags.carryAligned) reasons.push(`against carry (${c.diffPct.toFixed(2)}%)`);
      }
    }

    const p = pos(signal.pair);
    if (p) {
      tags.cotPairIndex = p.pairIndex;
      const crowdedWith = (dir === 1 && p.pairIndex >= f.cotCrowdedIndex) || (dir === -1 && p.pairIndex <= 100 - f.cotCrowdedIndex);
      if (crowdedWith) {
        tags.crowded = true;
        if (f.blockOnCrowded) reasons.push(`crowded ${signal.side} (COT ${p.pairIndex.toFixed(0)})`);
      }
    }
    return { allowed: reasons.length === 0, reasons, tags };
  };
}
