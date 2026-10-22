import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from './config.js';

export const FILES = {
  signals: 'signals.jsonl',
  outcomes: 'outcomes.jsonl',
  strangles: 'strangles.jsonl',
  strangleOutcomes: 'strangle_outcomes.jsonl',
};

export function pathFor(name) {
  return join(DATA_DIR, FILES[name] ?? name);
}

export function readJsonl(name) {
  const p = pathFor(name);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function appendJsonl(name, record) {
  const p = pathFor(name);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(record) + '\n');
}
