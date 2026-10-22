// CSV with a header row: time,open,high,low,close[,volume]. time is ISO-8601 or epoch seconds/ms.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resample, tfMs } from './resample.js';

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
  const idx = (names) => header.findIndex((h) => names.includes(h));
  const iT = idx(['time', 'timestamp', 'date', 'datetime']);
  const [iO, iH, iL, iC, iV] = [idx(['open', 'o']), idx(['high', 'h']), idx(['low', 'l']), idx(['close', 'c']), idx(['volume', 'v'])];
  if ([iT, iO, iH, iL, iC].some((i) => i < 0)) throw new Error('CSV needs time,open,high,low,close columns');
  const out = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const raw = f[iT].trim();
    let t = /^\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (t < 1e12) t *= 1000;
    const c = { t, o: +f[iO], h: +f[iH], l: +f[iL], c: +f[iC], v: iV >= 0 ? +f[iV] : 0 };
    if (Number.isFinite(t) && [c.o, c.h, c.l, c.c].every(Number.isFinite)) out.push(c);
  }
  return out.sort((a, b) => a.t - b.t);
}

// Looks for <dir>/<PAIR>_<tf>.csv, or falls back to a finer file and resamples it.
export function loadCsv(pair, tf, dir) {
  const candidates = ['15m', '30m', '1h', '4h', '1d'].filter((x) => tfMs(x) <= tfMs(tf)).reverse();
  for (const src of candidates) {
    try {
      const candles = parseCsv(readFileSync(join(dir, `${pair}_${src}.csv`), 'utf8'));
      return src === tf ? candles : resample(candles, tf);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  throw new Error(`No CSV for ${pair} ${tf} in ${dir}`);
}
