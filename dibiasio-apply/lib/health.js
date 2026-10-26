// Things agents need to know about even when nothing else tells them: the
// storage disk filling up, and alerts that failed to send (so a new
// application could otherwise go unnoticed). State is kept on the data disk.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const FILE = path.join(store.DATA_DIR, 'health.json');
const WARN_PCT = Number(process.env.STORAGE_WARN_PCT || 80);
const CRITICAL_PCT = Number(process.env.STORAGE_CRITICAL_PCT || 95);

let state = { storageLevel: 0, failures: [] };
try { state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { /* first run */ }
const save = () => fs.writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });

function storage() {
  const s = fs.statfsSync(store.DATA_DIR);
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  const pct = total ? Math.round(((total - free) / total) * 1000) / 10 : 0;
  return {
    pct,
    usedMB: Math.round((total - free) / 1048576),
    totalMB: Math.round(total / 1048576),
    freeMB: Math.round(free / 1048576),
    level: pct >= CRITICAL_PCT ? 2 : pct >= WARN_PCT ? 1 : 0,
  };
}

module.exports = {
  storage,

  // Calls onRise(storage) once each time usage climbs into a higher level
  // (80%, then 95%), so the warning email isn't repeated on every upload.
  async checkStorage(onRise) {
    let st;
    try { st = storage(); } catch (e) { console.error('[health] could not read disk usage:', e.message); return null; }
    if (st.level !== state.storageLevel) {
      const rose = st.level > state.storageLevel;
      state.storageLevel = st.level;
      try { save(); } catch (e) { console.error('[health] could not save state:', e.message); }
      if (rose) await onRise(st).catch((e) => module.exports.recordFailure({ what: 'Storage warning email', error: e.message }));
    }
    return st;
  },

  recordFailure({ what, dealId, property, error }) {
    state.failures.unshift({ at: new Date().toISOString(), what, dealId: dealId || null, property: property || '', error: String(error || '').slice(0, 300) });
    state.failures = state.failures.slice(0, 50);
    try { save(); } catch (e) { console.error('[health] could not record failure:', e.message); }
  },

  failures: () => state.failures,
  dismissFailures() { state.failures = []; save(); },
};
