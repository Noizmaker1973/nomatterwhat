// Position sizing and loss limits.

// How much quote currency (e.g. USDT) to spend on a BUY.
// Sized so that hitting the stop-loss loses ~riskPerTradePct of equity,
// capped by the max position size and available cash.
// stopLoss === null means the strategy has no stop (moving-average mode):
// the position is sized by the caps alone. undefined (no signal at all)
// falls back to assuming a 5% stop.
// side 'short' sizes a short position, whose stop sits above the price.
function sizeBuy({ equity, cash, price, stopLoss, currentPositionValue = 0, side = 'long' }, risk) {
  const riskAmount = equity * (risk.riskPerTradePct / 100);
  const distance = side === 'short' ? stopLoss - price : price - stopLoss;
  const stopDistancePct = stopLoss && distance > 0 ? distance / price : 0.05;
  const byRisk = stopLoss === null ? Infinity : riskAmount / stopDistancePct;
  const byMaxPosition = equity * (risk.maxPositionPct / 100) - currentPositionValue;
  const byCash = cash * 0.995; // leave room for fees
  const amount = Math.min(byRisk, byMaxPosition, byCash);
  if (!(amount >= risk.minOrderSize)) {
    const reason = byMaxPosition < risk.minOrderSize ? 'Max position size reached' : 'Not enough cash for minimum order';
    return { amount: 0, reason };
  }
  return { amount: Math.floor(amount * 100) / 100, reason: null };
}

// Tracks equity at the start of each UTC day and halts new buys once the
// drawdown for the day exceeds the configured limit.
class DailyLossGuard {
  constructor(limitPct) {
    this.limitPct = limitPct;
    this.day = null;
    this.startEquity = null;
  }

  update(equity, now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.startEquity = equity;
    }
    const drawdownPct = this.startEquity > 0 ? ((this.startEquity - equity) / this.startEquity) * 100 : 0;
    return { halted: drawdownPct >= this.limitPct, drawdownPct, startEquity: this.startEquity };
  }
}

// Backtests run each coin on its own account. On the platform, N coins share
// one account, so each coin's slice is 1/N of it, and the per-trade risk and
// position cap (both % of the WHOLE account) are N times larger relative to
// that slice. Averaging the slices' returns then gives the whole-account return.
function shareOfAccount(risk, coins) {
  return {
    ...risk,
    riskPerTradePct: risk.riskPerTradePct * coins,
    maxPositionPct: Math.min(100, risk.maxPositionPct * coins),
  };
}

module.exports = { sizeBuy, DailyLossGuard, shareOfAccount };
