import { join } from 'node:path';
import { ROOT } from '../config.js';
import { fetchYahoo } from './yahoo.js';
import { fetchOanda } from './oanda.js';
import { loadCsv } from './csv.js';
import { synthetic } from './synthetic.js';
import { closedOnly } from './resample.js';

export async function getCandles(pair, tf, config, opts = {}) {
  const source = opts.source ?? config.data.source;
  try {
    return await load(pair, tf, config, source, opts);
  } catch (e) {
    const cause = e.cause?.code ?? e.cause?.message;
    throw new Error(`[${source}] ${e.message}${cause ? ` (${cause})` : ''}`);
  }
}

async function load(pair, tf, config, source, opts) {
  let candles;
  switch (source) {
    case 'yahoo':
      candles = await fetchYahoo(pair, tf, opts);
      break;
    case 'oanda':
      candles = await fetchOanda(pair, tf, { env: config.data.oandaEnv, ...opts });
      break;
    case 'csv':
      candles = loadCsv(pair, tf, join(ROOT, config.data.csvDir));
      break;
    case 'synthetic':
      return synthetic(pair, tf, opts);
    default:
      throw new Error(`Unknown data source ${source}`);
  }
  return closedOnly(candles, tf);
}
