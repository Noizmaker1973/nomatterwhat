// SPAN-style scenario margin ESTIMATE. Real CME margin (SPAN / SPAN 2) and your broker's
// house margin can be materially higher, and both expand when volatility does.
// Default scan (4 sd over 3 days, ~2.7% at 7.5 IV) is near CME's 6E futures scan range.
// 16 scenarios: price at 0, +-1/3, +-2/3, +-3/3 of the scan range, each with vol up and
// down, plus two extreme moves (2x scan) counted at 35%. Margin = worst scenario loss.
import { strangleValue } from './strangle.js';

export function spanEstimate(s, contract, { scanSigmas = 4, scanDays = 3, volScanPct = 25 } = {}) {
  const sigma = s.ivPct / 100;
  const scanRange = s.F * sigma * Math.sqrt(scanDays / 365) * scanSigmas;
  const T1 = Math.max(s.T - 1 / 365, 1e-6);
  const now = strangleValue(s, s.F, s.T, sigma);
  const scen = [];
  for (const frac of [0, 1 / 3, -1 / 3, 2 / 3, -2 / 3, 1, -1]) {
    for (const vs of [1, -1]) {
      const v = sigma * (1 + (vs * volScanPct) / 100);
      scen.push({ move: frac * scanRange, vol: v, weight: 1 });
    }
  }
  scen.push({ move: 2 * scanRange, vol: sigma, weight: 0.35 }, { move: -2 * scanRange, vol: sigma, weight: 0.35 });
  let worst = 0;
  let worstScen = null;
  for (const sc of scen) {
    const loss = (strangleValue(s, s.F + sc.move, T1, sc.vol) - now) * contract.multiplier * s.contracts * sc.weight;
    if (loss > worst) {
      worst = loss;
      worstScen = sc;
    }
  }
  const shortOptionMin = 0.1 * scanRange * contract.multiplier * s.contracts * 2;
  return {
    marginUsd: Math.max(worst, shortOptionMin),
    scanRangePts: scanRange,
    scanRangePct: (scanRange / s.F) * 100,
    worstScenario: worstScen && { movePct: (worstScen.move / s.F) * 100, volPct: worstScen.vol * 100, weight: worstScen.weight },
    note: 'Estimate only; check broker/CME margin. Margin rises with vol - the margin call and the loss tend to arrive together.',
  };
}
