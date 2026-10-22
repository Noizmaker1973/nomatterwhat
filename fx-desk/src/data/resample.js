export const TF_MS = {
  '15m': 15 * 60e3,
  '30m': 30 * 60e3,
  '1h': 60 * 60e3,
  '4h': 4 * 60 * 60e3,
  '1d': 24 * 60 * 60e3,
};

export function tfMs(tf) {
  const ms = TF_MS[tf];
  if (!ms) throw new Error(`Unsupported timeframe ${tf}; use one of ${Object.keys(TF_MS).join(', ')}`);
  return ms;
}

// Aggregate candles into buckets aligned to UTC multiples of tf.
export function resample(candles, tf) {
  const ms = tfMs(tf);
  const out = [];
  let cur = null;
  for (const c of candles) {
    const bucket = Math.floor(c.t / ms) * ms;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v ?? 0 };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Drop the trailing candle if it has not closed yet.
export function closedOnly(candles, tf, now = Date.now()) {
  const ms = tfMs(tf);
  return candles.filter((c) => c.t + ms <= now);
}
