// Options ideas: a limited-risk options trade that fits each signal, priced
// with Black-Scholes from the coin's recent (realized) volatility.
//
// These are ESTIMATES for education and planning. Real option prices use
// implied volatility, which is usually higher than realized volatility (so
// real premiums are often larger) and changes fast. Nothing here places
// options orders: Binance.US has no options, so you would trade them
// elsewhere (see the README) after checking real quotes.

const DAYS = 30; // expiry used for every idea

// Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7).
function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Black-Scholes price with zero interest rate (crypto has no clean risk-free rate).
function bsPrice(type, S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return Math.max(type === 'call' ? S - K : K - S, 0);
  const sd = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (sigma * sigma * T) / 2) / sd;
  const d2 = d1 - sd;
  return type === 'call' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
}

// Model probability that the price ends above K at expiry.
function probAbove(S, K, T, sigma) {
  const sd = sigma * Math.sqrt(T);
  return normCdf((Math.log(S / K) - (sigma * sigma * T) / 2) / sd);
}

// Annualized volatility from the last `lookback` candles' log returns.
function realizedVol(closes, tfMs, lookback = 30) {
  const recent = closes.slice(-(lookback + 1));
  if (recent.length < 10) return null;
  const rets = recent.slice(1).map((c, i) => Math.log(c / recent[i]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * ((365 * 86400e3) / tfMs));
}

// Strike spacing of about 1% of the price, rounded to 1, 2 or 5 x a power of
// ten: BTC ~$500, ETH ~$20, BNB ~$5, SOL ~$1-2.
function strikeStep(S) {
  const target = S * 0.01;
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).reduce((best, x) => (Math.abs(x - target) < Math.abs(best - target) ? x : best));
}

function roundStrike(x, S) {
  const step = strikeStep(S);
  return Number((Math.round(x / step) * step).toPrecision(12));
}

// Volatility over the last 30 days of candles (or as many as there are), so
// hourly and daily coins are measured over a comparable stretch of time.
function recentVol(closes, tfMs) {
  return realizedVol(closes, tfMs, Math.min(closes.length - 1, Math.round((30 * 86400e3) / tfMs)));
}

// direction: 'bullish' | 'bearish'; holding: you own the coin.
function optionIdea({ direction, price: S, closes, tfMs, holding }) {
  const sigma = recentVol(closes, tfMs);
  if (!sigma || !(S > 0)) return null;
  const T = DAYS / 365;
  const move = S * sigma * Math.sqrt(T); // one standard deviation over the period
  const base = { expiryDays: DAYS, volatilityPct: sigma * 100, expectedMove: move };

  if (direction === 'bullish' && holding) {
    // Covered call: earn a premium on coins you hold; upside capped at the strike.
    const K = roundStrike(S + 0.5 * move, S);
    const premium = bsPrice('call', S, K, T, sigma);
    return {
      ...base,
      strategy: 'covered-call',
      title: 'Covered call',
      legs: [{ action: 'sell', type: 'call', strike: K, premium }],
      credit: premium,
      yieldPct: (premium / S) * 100,
      maxLoss: S - premium, // same downside as holding (if the coin went to zero), less the premium
      breakeven: S - premium,
      probProfit: probAbove(S, S - premium, T, sigma),
      probAssigned: probAbove(S, K, T, sigma),
      summary: `Sell 1 call at ${K} expiring in ${DAYS} days against 1 coin you hold. You keep the premium; if the price ends above ${K} your coin is sold at ${K} (gains above that are given up).`,
    };
  }
  if (direction === 'bullish') {
    // Cash-secured put: get paid to wait to buy lower.
    const K = roundStrike(S - 0.5 * move, S);
    const premium = bsPrice('put', S, K, T, sigma);
    return {
      ...base,
      strategy: 'cash-secured-put',
      title: 'Cash-secured put',
      legs: [{ action: 'sell', type: 'put', strike: K, premium }],
      credit: premium,
      collateral: K,
      yieldPct: (premium / K) * 100,
      maxLoss: K - premium, // if the coin went to zero
      breakeven: K - premium,
      probProfit: probAbove(S, K - premium, T, sigma),
      probAssigned: 1 - probAbove(S, K, T, sigma),
      summary: `Sell 1 put at ${K} expiring in ${DAYS} days, keeping ${K} in cash aside. You keep the premium; if the price ends below ${K} you buy 1 coin at ${K}.`,
    };
  }
  // Bearish: bear call spread. Limited risk, unlike selling a naked call.
  const K1 = roundStrike(S + 0.5 * move, S);
  let K2 = roundStrike(S + 1.0 * move, S);
  if (K2 <= K1) K2 = K1 + strikeStep(S);
  const credit = bsPrice('call', S, K1, T, sigma) - bsPrice('call', S, K2, T, sigma);
  return {
    ...base,
    strategy: 'bear-call-spread',
    title: 'Bear call spread',
    legs: [
      { action: 'sell', type: 'call', strike: K1, premium: bsPrice('call', S, K1, T, sigma) },
      { action: 'buy', type: 'call', strike: K2, premium: bsPrice('call', S, K2, T, sigma) },
    ],
    credit,
    maxLoss: K2 - K1 - credit,
    breakeven: K1 + credit,
    probProfit: 1 - probAbove(S, K1 + credit, T, sigma),
    summary: `Sell 1 call at ${K1} and buy 1 call at ${K2}, both expiring in ${DAYS} days. You keep the credit if the price stays below ${K1}; the most you can lose is ${K2 - K1} minus the credit, if it ends above ${K2}.`,
  };
}

// Iron condor: a bet that the price stays in a range until expiry.
//   sell a put and a call about half a standard deviation from the price,
//   buy a put and a call one full standard deviation away as protection.
// You collect the net premium up front and keep all of it if the price ends
// between the two sold strikes. The bought options cap the loss either way.
function ironCondor({ price: S, closes, tfMs }) {
  const sigma = recentVol(closes, tfMs);
  if (!sigma || !(S > 0)) return null;
  const T = DAYS / 365;
  const move = S * sigma * Math.sqrt(T);
  const step = strikeStep(S);

  const sellPut = Math.min(roundStrike(S - 0.5 * move, S), roundStrike(S, S) - step);
  const buyPut = Math.min(roundStrike(S - move, S), sellPut - step);
  const sellCall = Math.max(roundStrike(S + 0.5 * move, S), roundStrike(S, S) + step);
  const buyCall = Math.max(roundStrike(S + move, S), sellCall + step);

  const legs = [
    { action: 'buy', type: 'put', strike: buyPut, premium: bsPrice('put', S, buyPut, T, sigma) },
    { action: 'sell', type: 'put', strike: sellPut, premium: bsPrice('put', S, sellPut, T, sigma) },
    { action: 'sell', type: 'call', strike: sellCall, premium: bsPrice('call', S, sellCall, T, sigma) },
    { action: 'buy', type: 'call', strike: buyCall, premium: bsPrice('call', S, buyCall, T, sigma) },
  ];
  // Premium collected per coin: what the sold options pay minus what the bought ones cost.
  const credit = legs.reduce((sum, l) => sum + (l.action === 'sell' ? l.premium : -l.premium), 0);
  const width = Math.max(sellPut - buyPut, buyCall - sellCall);
  const maxLoss = width - credit;
  const lower = sellPut - credit;
  const upper = sellCall + credit;
  return {
    strategy: 'iron-condor',
    title: 'Iron condor',
    expiryDays: DAYS,
    volatilityPct: sigma * 100,
    expectedMove: move,
    legs,
    credit, // = the most you can make, per coin
    maxProfit: credit,
    maxLoss,
    returnOnRiskPct: (credit / maxLoss) * 100,
    // A premium under ~10% of the max loss rarely pays for the risk and fees.
    worthIt: credit / maxLoss >= 0.1,
    breakevens: [lower, upper],
    range: [sellPut, sellCall],
    probProfit: probAbove(S, lower, T, sigma) - probAbove(S, upper, T, sigma),
    probMaxProfit: probAbove(S, sellPut, T, sigma) - probAbove(S, sellCall, T, sigma),
    summary:
      `Sell the ${sellPut} put and ${sellCall} call, buy the ${buyPut} put and ${buyCall} call, all expiring in ${DAYS} days. ` +
      `You keep the whole premium if the price ends between ${sellPut} and ${sellCall}. ` +
      `Beyond the bought strikes the loss stops growing.`,
  };
}

module.exports = { optionIdea, ironCondor, bsPrice, normCdf, probAbove, realizedVol, roundStrike };
