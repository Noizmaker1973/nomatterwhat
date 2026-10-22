// Stress panel for a short strangle. Two kinds of rows:
//  - sigma rows: underlying moves k x the expected move over the option's life, valued at
//    expiry (intrinsic) and immediately with an IV shock (the realistic way it hurts).
//  - gap rows: an overnight jump of movePct with IV multiplied by gapIvMultiplier.
// Both directions are shown, because which side gaps is the thing you can't know.
import { strangleExpiryPnl, strangleMarkPnl } from './strangle.js';
import { spanEstimate } from './margin.js';

export function stressPanel(s, contract, cfg) {
  const sigma = s.ivPct / 100;
  const rows = [];
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const F = s.F + k * s.expectedMove;
    rows.push({
      scenario: `${k > 0 ? '+' : ''}${k} sigma (life)`,
      movePct: ((F - s.F) / s.F) * 100,
      F,
      pnlAtExpiry: strangleExpiryPnl(s, contract, F),
      pnlNowIvShock: strangleMarkPnl(s, contract, F, s.T, sigma * cfg.stressIvMultiplier, cfg.feePerContractPerSide),
    });
  }
  for (const g of cfg.gapScenarios) {
    for (const sign of [1, -1]) {
      const F = s.F * (1 + (sign * g.movePct) / 100);
      rows.push({
        scenario: `${g.name} ${sign > 0 ? 'up' : 'down'}`,
        movePct: sign * g.movePct,
        F,
        pnlAtExpiry: strangleExpiryPnl(s, contract, F),
        pnlNowIvShock: strangleMarkPnl(s, contract, F, s.T, sigma * cfg.gapIvMultiplier, cfg.feePerContractPerSide),
      });
    }
  }
  for (const row of rows) row.creditsLost = s.creditUsd > 0 ? -Math.min(row.pnlNowIvShock, 0) / s.creditUsd : null;
  // Margin after a 1-sigma-day adverse move with IV up 50%: what your broker asks for on the bad day.
  const dayMove = s.F * sigma * Math.sqrt(1 / 365);
  const stressedMargin = spanEstimate({ ...s, F: s.F + dayMove, ivPct: s.ivPct * 1.5 }, contract, {
    scanSigmas: cfg.marginScanSigmas,
    scanDays: cfg.marginScanDays,
    volScanPct: cfg.marginVolScanPct,
  });
  return { rows, stressedMarginUsd: stressedMargin.marginUsd };
}
