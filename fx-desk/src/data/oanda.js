// OANDA v20 REST candles. Needs OANDA_API_TOKEN (a free practice account works).
// Read-only: this module never places orders.
const GRAN = { '15m': 'M15', '30m': 'M30', '1h': 'H1', '4h': 'H4', '1d': 'D' };

export async function fetchOanda(pair, tf, { count = 2000, env = 'practice' } = {}) {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) throw new Error('OANDA adapter needs OANDA_API_TOKEN');
  const gran = GRAN[tf];
  if (!gran) throw new Error(`OANDA adapter does not support ${tf}`);
  const host = env === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com';
  const instrument = `${pair.slice(0, 3)}_${pair.slice(3)}`;
  const url = `https://${host}/v3/instruments/${instrument}/candles?granularity=${gran}&count=${Math.min(count, 5000)}&price=MBA`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`OANDA ${pair} ${tf}: HTTP ${res.status}`);
  const json = await res.json();
  return json.candles
    .filter((c) => c.complete)
    .map((c) => ({
      t: Date.parse(c.time),
      o: +c.mid.o,
      h: +c.mid.h,
      l: +c.mid.l,
      c: +c.mid.c,
      v: c.volume,
      // Observed close spread, so you can replace the configured spreadPips with reality.
      spread: c.ask && c.bid ? +c.ask.c - +c.bid.c : undefined,
    }));
}
