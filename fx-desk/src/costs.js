import { parsePair } from './pairs.js';

// Round-trip cost as a percent of price. A spot round trip pays the spread once
// (buy at ask, sell at bid), plus slippage on each side and any commission.
export function roundTripCostPct(pair, price, config) {
  const info = parsePair(pair);
  const pairCfg = config.pairs?.[info.pair] ?? {};
  if (pairCfg.feePctRoundTrip != null) return pairCfg.feePctRoundTrip;
  const spreadPips = pairCfg.spreadPips ?? 1;
  const slipPips = (config.costs?.slippagePips ?? 0) * 2;
  const pricePct = (((spreadPips + slipPips) * info.pipSize) / price) * 100;
  return pricePct + (config.costs?.commissionPctRoundTrip ?? 0);
}
