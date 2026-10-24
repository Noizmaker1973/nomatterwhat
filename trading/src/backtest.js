// Backtester: replays the strategy over historical candles with the same
// risk sizing, stops, fees and slippage used for paper/live trading.
//
//   node src/backtest.js                 # all configured symbols
//   node src/backtest.js BTC SOL --bars 3000 --timeframe 4h

const config = require('./config');
const { createMarketData } = require('./marketData');
const { computeSeries, evaluateAt, signalFromScore, MIN_CANDLES } = require('./strategy');
const { sizeBuy, shareOfAccount } = require('./risk');
const { FEE_RATE, SLIPPAGE } = require('./brokers/paperBroker');

// `series` lets callers (the optimizer) reuse computed indicators across runs,
// and `scores` (from scoreSeries) reuses the per-candle scores as well.
// `from`/`to` limit trading to part of the history; indicators before `from`
// still count as warm-up, so there is no look-ahead.
function backtest(candles, { startingBalance = 10000, risk = config.risk, strategy = config.strategy, series, scores, from = MIN_CANDLES, to = candles.length } = {}) {
  const s = series || computeSeries(candles);
  const start = Math.max(from, MIN_CANDLES);
  const allowShort = Boolean(strategy.allowShort);
  // Borrowing cost of a short, charged per candle held.
  const barMs = candles.length > 1 ? candles[1][0] - candles[0][0] : 86400e3;
  const shortCostPerBar = ((strategy.shortCostApr ?? config.shortCostApr) / 100) * (barMs / (365 * 86400e3));
  let cash = startingBalance;
  // pos: { side, amount, entry, stopLoss, takeProfit, trailAtrMult, extreme, cost, time }
  // For a long, cash paid for the coins is `cost`. A short keeps its
  // collateral in cash and its profit/loss is amount x (entry - price).
  let pos = null;
  const trades = [];
  let peak = startingBalance;
  let maxDrawdown = 0;
  let exposureSum = 0;

  const close = (i, price, reason) => {
    if (pos.side === 'long') {
      const fill = price * (1 - SLIPPAGE);
      const proceeds = pos.amount * fill * (1 - FEE_RATE);
      cash += proceeds;
      trades.push({ side: 'long', entryTime: pos.time, exitTime: candles[i][0], entry: pos.entry, exit: fill, pnl: proceeds - pos.cost, reason });
    } else {
      const fill = price * (1 + SLIPPAGE);
      const result = pos.amount * (pos.entry - fill) - pos.amount * fill * FEE_RATE;
      cash += result;
      trades.push({ side: 'short', entryTime: pos.time, exitTime: candles[i][0], entry: pos.entry, exit: fill, pnl: result - pos.openFee - pos.carry, reason });
    }
    pos = null;
  };

  const openLong = (i, sig, price) => {
    const { amount } = sizeBuy({ equity: cash, cash, price, stopLoss: sig.stopLoss }, risk);
    if (!(amount > 0)) return;
    const fill = price * (1 + SLIPPAGE);
    pos = {
      side: 'long',
      amount: (amount * (1 - FEE_RATE)) / fill,
      entry: fill,
      stopLoss: sig.stopLoss,
      takeProfit: sig.takeProfit,
      trailAtrMult: sig.trailAtrMult,
      extreme: price,
      cost: amount,
      time: candles[i][0],
    };
    cash -= amount;
  };

  const openShort = (i, sig, price) => {
    const { amount } = sizeBuy({ equity: cash, cash, price, stopLoss: sig.shortStop, side: 'short' }, risk);
    if (!(amount > 0)) return;
    const fill = price * (1 - SLIPPAGE);
    const openFee = amount * FEE_RATE;
    cash -= openFee;
    pos = {
      side: 'short',
      amount: amount / fill,
      entry: fill,
      stopLoss: sig.shortStop,
      takeProfit: sig.shortTarget,
      trailAtrMult: sig.trailAtrMult,
      extreme: price,
      openFee,
      carry: 0,
      time: candles[i][0],
    };
  };

  const equityAt = (price) => {
    if (!pos) return cash;
    return pos.side === 'long' ? cash + pos.amount * price : cash + pos.amount * (pos.entry - price);
  };

  for (let i = start; i < to; i++) {
    const [, open, high, low, closePrice] = candles[i];

    // Stops are checked intra-bar against levels known before this bar. If
    // both levels fall inside one candle we assume the stop hit first (the
    // pessimistic case). A gap through the stop fills at the open.
    if (pos && pos.side === 'long') {
      if (pos.stopLoss && low <= pos.stopLoss) close(i, Math.min(pos.stopLoss, open), pos.trailAtrMult ? 'trailing stop' : 'stop-loss');
      else if (pos.takeProfit && high >= pos.takeProfit) close(i, Math.max(pos.takeProfit, open), 'take-profit');
    } else if (pos && pos.side === 'short') {
      if (pos.stopLoss && high >= pos.stopLoss) close(i, Math.max(pos.stopLoss, open), pos.trailAtrMult ? 'trailing stop' : 'stop-loss');
      else if (pos.takeProfit && low <= pos.takeProfit) close(i, Math.min(pos.takeProfit, open), 'take-profit');
    }
    // Trailing stops ratchet towards profit, never back.
    if (pos && pos.trailAtrMult) {
      if (pos.side === 'long') {
        pos.extreme = Math.max(pos.extreme, high);
        pos.stopLoss = Math.max(pos.stopLoss, pos.extreme - pos.trailAtrMult * s.atr[i]);
      } else {
        pos.extreme = Math.min(pos.extreme, low);
        pos.stopLoss = Math.min(pos.stopLoss, pos.extreme + pos.trailAtrMult * s.atr[i]);
      }
    }
    if (pos && pos.side === 'short') {
      const carry = pos.amount * closePrice * shortCostPerBar;
      cash -= carry;
      pos.carry += carry;
    }

    const sig = scores ? signalFromScore(scores, i, s, strategy) : evaluateAt(s, i, strategy);
    if (sig.signal === 'BUY') {
      if (pos && pos.side === 'short') close(i, closePrice, 'buy signal');
      if (!pos) openLong(i, sig, closePrice);
    } else if (sig.signal === 'SELL') {
      if (pos && pos.side === 'long') close(i, closePrice, 'sell signal');
      if (!pos && allowShort && sig.canShort) openShort(i, sig, closePrice);
    }

    const equity = equityAt(closePrice);
    if (pos) exposureSum += (pos.amount * closePrice) / Math.max(equity, 1e-9);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const last = candles[to - 1][4];
  const finalEquity = equityAt(last);
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);
  const shorts = trades.filter((t) => t.side === 'short');

  return {
    grossWin,
    grossLoss,
    startingBalance,
    finalEquity,
    returnPct: ((finalEquity - startingBalance) / startingBalance) * 100,
    buyHoldPct: ((last - candles[start][4]) / candles[start][4]) * 100,
    exposurePct: (exposureSum / Math.max(to - start, 1)) * 100,
    trades: trades.length,
    shortTrades: shorts.length,
    shortPnl: shorts.reduce((a, t) => a + t.pnl, 0),
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDrawdown * 100,
    openPosition: Boolean(pos),
    tradeLog: trades,
  };
}

function checkTimeframe(tf) {
  if (/^\d+$/.test(tf)) {
    throw new Error(`Invalid timeframe "${tf}". In PowerShell, put timeframes in quotes, e.g. --timeframe "1d"`);
  }
  return tf;
}

function parseArgs(argv) {
  const args = { bases: [], bars: 2000, timeframe: config.timeframe };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bars') args.bars = parseInt(argv[++i], 10);
    else if (argv[i] === '--timeframe') args.timeframe = checkTimeframe(argv[++i]);
    else if (argv[i] === '--demo') continue; // handled in config.js
    else args.bases.push(argv[i].toUpperCase());
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.bases.length ? args.bases.map((b) => `${b}/${config.quote}`) : config.symbols;
  const marketData = createMarketData(config);
  console.log(
    `Backtest | ${marketData.name} | ${args.timeframe} | ${args.bars} bars | ${config.strategy.mode} mode | ` +
      `each coin trades 1/${config.symbols.length} of the account | ` +
      (config.strategy.allowShort ? `shorting ON (borrow cost ${config.shortCostApr}%/yr) | ` : 'long only | ') +
      `fees ${FEE_RATE * 100}% + slippage ${SLIPPAGE * 100}%\n`
  );

  const rows = [];
  for (const symbol of symbols) {
    try {
      const candles = await marketData.fetchHistory(symbol, args.timeframe, args.bars);
      if (candles.length <= MIN_CANDLES + 10) throw new Error(`only ${candles.length} candles returned`);
      // Each coin trades its share of one account, like on the platform.
      const r = backtest(candles, { risk: shareOfAccount(config.risk, config.symbols.length) });
      const from = new Date(candles[MIN_CANDLES][0]).toISOString().slice(0, 10);
      const to = new Date(candles[candles.length - 1][0]).toISOString().slice(0, 10);
      rows.push({
        symbol,
        period: `${from} → ${to}`,
        'return %': r.returnPct.toFixed(2),
        'buy&hold %': r.buyHoldPct.toFixed(2),
        trades: r.trades,
        ...(config.strategy.allowShort ? { shorts: r.shortTrades, 'short P&L': r.shortPnl.toFixed(0) } : {}),
        'win %': r.winRatePct.toFixed(1),
        'profit factor': Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : '∞',
        'max DD %': r.maxDrawdownPct.toFixed(2),
        'exposure %': r.exposurePct.toFixed(1),
      });
    } catch (err) {
      rows.push({ symbol, period: `ERROR: ${err.message}` });
    }
  }
  console.table(rows);
  console.log('\nreturn % and exposure % are for that coin\'s share of the account. exposure % = average');
  console.log('share invested; buy & hold is always 100%, so also compare buy&hold % x exposure % / 100.');
  console.log('Past performance does not guarantee future results.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { backtest, checkTimeframe };
