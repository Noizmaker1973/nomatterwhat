// All indicator functions return arrays aligned to the input, with null during warmup.

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (i < n - 1) continue;
    if (prev === null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += values[j];
      prev = s / n;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rollingStdev(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += values[j];
    const m = s / n;
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (values[j] - m) ** 2;
    out[i] = Math.sqrt(v / n);
  }
  return out;
}

// Wilder ATR.
export function atr(candles, n) {
  const out = new Array(candles.length).fill(null);
  let prev = null;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tr = i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c));
    if (i < n) {
      sum += tr;
      if (i === n - 1) out[i] = prev = sum / n;
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

export function bollinger(closes, n, k) {
  const mid = sma(closes, n);
  const sd = rollingStdev(closes, n);
  return closes.map((_, i) => {
    if (mid[i] === null) return null;
    const upper = mid[i] + k * sd[i];
    const lower = mid[i] - k * sd[i];
    return { mid: mid[i], upper, lower, width: (upper - lower) / mid[i] };
  });
}

// Highest high / lowest low of the n bars BEFORE i (current bar excluded, so a close above it is a breakout).
export function donchian(candles, n) {
  return candles.map((_, i) => {
    if (i < n) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n; j < i; j++) {
      if (candles[j].h > hi) hi = candles[j].h;
      if (candles[j].l < lo) lo = candles[j].l;
    }
    return { high: hi, low: lo };
  });
}

// Fraction of values strictly below x (0..1).
export function percentileRank(values, x) {
  if (!values.length) return null;
  let below = 0;
  for (const v of values) if (v < x) below++;
  return below / values.length;
}

export function rsi(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= n) {
      gain += g;
      loss += l;
      if (i === n) {
        gain /= n;
        loss /= n;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}
