import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.FX_DESK_DATA_DIR || join(ROOT, 'data');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

// config/default.json, overridden by config/local.json if present (gitignored by convention).
export function loadConfig() {
  const base = readJson(join(ROOT, 'config', 'default.json'));
  const localPath = join(ROOT, 'config', 'local.json');
  return existsSync(localPath) ? merge(base, readJson(localPath)) : base;
}

export function loadRates() {
  return readJson(join(ROOT, 'config', 'rates.json'));
}
