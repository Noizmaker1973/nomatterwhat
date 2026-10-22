import { price, greeks, strikeForDelta, probAbove } from './black76.js';

const DAY = 1 / 365;

export function snap(value, step, dir) {
  const n = value / step;
  const k = dir === 'up' ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return +(k * step).toPrecision(12);
}

// Short strangle at target |delta| on each side, strikes snapped OUTWARD to the exchange grid.
export function buildStrangle({ F, ivPct, dte, delta, contract, contracts = 1, r = 0, slippageTicksPerLeg = 0, feePerContractPerSide = 0 }) {
  const T = dte * DAY;
  const sigma = ivPct / 100;
  const Kc = snap(strikeForDelta('call', F, T, sigma, delta, r), contract.strikeStep, 'up');
  const Kp = snap(strikeForDelta('put', F, T, sigma, delta, r), contract.strikeStep, 'down');
  const call = greeks('call', F, Kc, T, sigma, r);
  const put = greeks('put', F, Kp, T, sigma, r);
  const slip = slippageTicksPerLeg * contract.tick;
  const creditPts = call.price + put.price - 2 * slip; // you sell at the bid, not the model mid
  const feesOpen = 2 * contracts * feePerContractPerSide;
  const creditUsd = creditPts * contract.multiplier * contracts - feesOpen;
  const beUp = Kc + creditPts;
  const beDown = Kp - creditPts;
  const expectedMove = F * sigma * Math.sqrt(T);
  return {
    F,
    ivPct,
    dte,
    T,
    r,
    contracts,
    callStrike: Kc,
    putStrike: Kp,
    call,
    put,
    creditPts,
    creditUsd,
    feesOpen,
    breakevenUp: beUp,
    breakevenDown: beDown,
    expectedMove,
    expectedMovePct: (expectedMove / F) * 100,
    popOtm: probAbove(F, Kp, T, sigma) - probAbove(F, Kc, T, sigma),
    popProfit: probAbove(F, beDown, T, sigma) - probAbove(F, beUp, T, sigma),
    netDelta: -(call.delta + put.delta) * contracts,
    netVega: -(call.vega + put.vega) * contract.multiplier * contracts,
    netThetaUsd: -(call.theta + put.theta) * contract.multiplier * contracts,
  };
}

// Current value (in price points) of the two short legs.
export function strangleValue(s, F, T, sigma) {
  return price('call', F, s.callStrike, T, sigma, s.r) + price('put', F, s.putStrike, T, sigma, s.r);
}

// P&L in USD if the position is closed now at model value (round-trip fees included).
export function strangleMarkPnl(s, contract, F, T, sigma, feePerContractPerSide = 0) {
  const value = strangleValue(s, F, T, sigma);
  return (s.creditPts - value) * contract.multiplier * s.contracts - s.feesOpen - 2 * s.contracts * feePerContractPerSide;
}

export function strangleExpiryPnl(s, contract, F) {
  const intrinsic = Math.max(F - s.callStrike, 0) + Math.max(s.putStrike - F, 0);
  return (s.creditPts - intrinsic) * contract.multiplier * s.contracts - s.feesOpen;
}
