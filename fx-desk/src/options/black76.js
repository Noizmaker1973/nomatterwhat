// Black-76: European options on futures (CME FX options settle into the future).
// T in years, sigma and r as decimals.

export function normCdf(x) {
  // Abramowitz-Stegun 7.1.26 via erf, |error| < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Acklam's rational approximation of the inverse normal CDF.
export function normInv(p) {
  if (p <= 0 || p >= 1) throw new Error(`normInv domain: ${p}`);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function d1d2(F, K, T, sigma) {
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * v * v) / v;
  return [d1, d1 - v];
}

export function price(type, F, K, T, sigma, r = 0) {
  if (T <= 0 || sigma <= 0) return Math.max(type === 'call' ? F - K : K - F, 0);
  const df = Math.exp(-r * T);
  const [d1, d2] = d1d2(F, K, T, sigma);
  return type === 'call' ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
}

export function greeks(type, F, K, T, sigma, r = 0) {
  const df = Math.exp(-r * T);
  const [d1] = d1d2(F, K, T, sigma);
  const sqT = Math.sqrt(T);
  const p = price(type, F, K, T, sigma, r);
  return {
    price: p,
    delta: type === 'call' ? df * normCdf(d1) : -df * normCdf(-d1),
    gamma: (df * normPdf(d1)) / (F * sigma * sqT),
    vega: (df * F * normPdf(d1) * sqT) / 100, // per 1 vol point
    theta: (-(df * F * normPdf(d1) * sigma) / (2 * sqT) + r * p) / 365, // per calendar day
  };
}

// Strike whose absolute delta equals targetDelta (e.g. 0.16).
export function strikeForDelta(type, F, T, sigma, targetDelta, r = 0) {
  const df = Math.exp(-r * T);
  const v = sigma * Math.sqrt(T);
  const d1 = type === 'call' ? normInv(targetDelta / df) : -normInv(targetDelta / df);
  return F * Math.exp(-d1 * v + 0.5 * v * v);
}

// Probability the future finishes above K at expiry (driftless lognormal).
export function probAbove(F, K, T, sigma) {
  return normCdf(d1d2(F, K, T, sigma)[1]);
}

export function impliedVol(type, premium, F, K, T, r = 0) {
  let lo = 1e-4;
  let hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (price(type, F, K, T, mid, r) > premium) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
