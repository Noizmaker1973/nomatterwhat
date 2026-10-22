// Free, keyless, unofficial Yahoo Finance chart endpoint. FX symbols look like EURUSD=X.
// Good enough for research; for anything near execution use broker data (OANDA adapter).
import { resample } from './resample.js';

const NATIVE = { '15m': '15m', '30m': '30m', '1h': '60m', '1d': '1d' };
const RANGE = { '15m': '60d', '30m': '60d', '60m': '730d', '1d': '10y' };

export async function fetchYahoo(pair, tf, { days } = {}) {
  const native = NATIVE[tf] ?? (tf === '4h' ? '60m' : null);
  if (!native) throw new Error(`Yahoo adapter does not support ${tf}`);
  const range = days ? `${days}d` : RANGE[native];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${pair}=X?interval=${native}&range=${range}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 fx-desk' } });
  if (!res.ok) throw new Error(`Yahoo ${pair} ${tf}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error(`Yahoo ${pair}: no data (${json?.chart?.error?.description ?? 'empty'})`);
  const q = r.indicators.quote[0];
  const candles = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue;
    candles.push({ t: r.timestamp[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return tf === '4h' ? resample(candles, '4h') : candles;
}
