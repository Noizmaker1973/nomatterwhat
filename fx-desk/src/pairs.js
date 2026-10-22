// Spot pair metadata and the CME FX future each one maps to.
// CME FX futures are quoted as USD per unit of foreign currency, so USD-base pairs
// (USDJPY, USDCAD, USDCHF) map to the reciprocal of spot.

export const CONTRACTS = {
  '6E': { name: 'Euro FX', currency: 'EUR', multiplier: 125000, tick: 0.00005, strikeStep: 0.005 },
  '6B': { name: 'British Pound', currency: 'GBP', multiplier: 62500, tick: 0.0001, strikeStep: 0.005 },
  '6J': { name: 'Japanese Yen', currency: 'JPY', multiplier: 12500000, tick: 0.0000005, strikeStep: 0.00005 },
  '6A': { name: 'Australian Dollar', currency: 'AUD', multiplier: 100000, tick: 0.00005, strikeStep: 0.005 },
  '6C': { name: 'Canadian Dollar', currency: 'CAD', multiplier: 100000, tick: 0.00005, strikeStep: 0.005 },
  '6S': { name: 'Swiss Franc', currency: 'CHF', multiplier: 125000, tick: 0.00005, strikeStep: 0.005 },
};

const FUTURE_BY_CCY = Object.fromEntries(Object.entries(CONTRACTS).map(([sym, c]) => [c.currency, sym]));

export function parsePair(pair) {
  const p = pair.toUpperCase().replace(/[^A-Z]/g, '');
  if (p.length !== 6) throw new Error(`Bad pair: ${pair}`);
  const base = p.slice(0, 3);
  const quote = p.slice(3);
  const pipSize = quote === 'JPY' ? 0.01 : 0.0001;
  const foreign = base === 'USD' ? quote : quote === 'USD' ? base : null;
  const future = foreign ? FUTURE_BY_CCY[foreign] ?? null : null;
  return { pair: p, base, quote, pipSize, future, futureInverted: base === 'USD' };
}

export function spotToFutureQuote(pairInfo, spot) {
  return pairInfo.futureInverted ? 1 / spot : spot;
}

export function futureToSpotQuote(pairInfo, fut) {
  return pairInfo.futureInverted ? 1 / fut : fut;
}
