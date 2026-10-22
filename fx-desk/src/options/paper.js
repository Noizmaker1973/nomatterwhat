// Paper strangles: log at open with everything needed to re-score later, then settle
// against daily spot candles once expiry has passed. Paper only - nothing here talks to a broker.
import { CONTRACTS, parsePair, spotToFutureQuote } from '../pairs.js';
import { buildStrangle, strangleExpiryPnl, strangleMarkPnl } from './strangle.js';
import { spanEstimate } from './margin.js';

const DAY_MS = 86400e3;

// Covered interest parity: F = S * (1 + (r_usd - r_foreign) * T), in the future's quote (USD per foreign unit).
export function futureFromSpot(pairInfo, spot, T, rates) {
  const s = spotToFutureQuote(pairInfo, spot);
  const ccy = CONTRACTS[pairInfo.future].currency;
  const rUsd = rates?.USD;
  const rF = rates?.[ccy];
  if (rUsd == null || rF == null) return s;
  return s * (1 + ((rUsd - rF) / 100) * T);
}

export function riskFreeRate(config, rates) {
  return (config.options.riskFreeRatePct ?? rates?.USD ?? 0) / 100;
}

export function openPaperStrangle({ pair, spot, ivPct, dte, delta, contracts = 1, config, rates, now = Date.now() }) {
  const info = parsePair(pair);
  if (!info.future) throw new Error(`${pair} has no CME FX future mapping`);
  const contract = CONTRACTS[info.future];
  const T = dte / 365;
  const F = futureFromSpot(info, spot, T, rates?.rates);
  const o = config.options;
  const s = buildStrangle({
    F,
    ivPct,
    dte,
    delta,
    contract,
    contracts,
    r: riskFreeRate(config, rates?.rates),
    slippageTicksPerLeg: o.slippageTicksPerLeg,
    feePerContractPerSide: o.feePerContractPerSide,
  });
  const margin = spanEstimate(s, contract, { scanSigmas: o.marginScanSigmas, scanDays: o.marginScanDays, volScanPct: o.marginVolScanPct });
  return {
    id: `STR-${info.pair}-${new Date(now).toISOString()}`,
    pair: info.pair,
    future: info.future,
    openedAt: new Date(now).toISOString(),
    expiry: new Date(now + dte * DAY_MS).toISOString(),
    spot,
    targetDelta: delta,
    marginUsd: margin.marginUsd,
    ...s,
    call: undefined,
    put: undefined,
    callDelta: s.call.delta,
    putDelta: s.put.delta,
  };
}

// daily: spot candles covering openedAt..expiry. Marks daily with the ENTRY IV (we don't have
// historical CME IV), so the stop check is an approximation; the expiry P&L is exact given spot.
export function scorePaperStrangle(s, daily, config, rates) {
  const info = parsePair(s.pair);
  const contract = CONTRACTS[s.future];
  const open = Date.parse(s.openedAt);
  const exp = Date.parse(s.expiry);
  const life = daily.filter((c) => c.t > open && c.t <= exp);
  if (!life.length || life[life.length - 1].t + DAY_MS < exp) return null;
  const stopLoss = -config.options.stopLossMultipleOfCredit * s.creditUsd;
  const fee = config.options.feePerContractPerSide;
  let worst = 0;
  let stopped = null;
  for (const c of life) {
    const Trem = Math.max((exp - c.t) / (365 * DAY_MS), 1e-6);
    for (const px of [c.h, c.l, c.c]) {
      const F = futureFromSpot(info, px, Trem, rates?.rates);
      const pnl = strangleMarkPnl(s, contract, F, Trem, s.ivPct / 100, fee);
      worst = Math.min(worst, pnl);
      if (!stopped && pnl <= stopLoss) stopped = { at: new Date(c.t).toISOString(), pnlUsd: pnl };
    }
  }
  const finalSpot = life[life.length - 1].c;
  const Fexp = spotToFutureQuote(info, finalSpot);
  const heldPnl = strangleExpiryPnl(s, contract, Fexp);
  return {
    id: s.id,
    pair: s.pair,
    expiry: s.expiry,
    finalSpot,
    finalFuture: Fexp,
    expiredOtm: Fexp < s.callStrike && Fexp > s.putStrike,
    heldToExpiryPnlUsd: heldPnl,
    withStopPnlUsd: stopped ? stopped.pnlUsd : heldPnl,
    stoppedAt: stopped?.at ?? null,
    worstMarkPnlUsd: worst,
    creditUsd: s.creditUsd,
    marginUsd: s.marginUsd,
    returnOnMarginPct: (heldPnl / s.marginUsd) * 100,
  };
}
