// Backtester: replays the strategy over historical candles with the same
// risk sizing, stops, fees and slippage used for paper/live trading.
//
//   node src/backtest.js                 # all configured symbols
//   node src/backtest.js BTC SOL --bars 3000 --timeframe 4h

const config = require('./config');
const { createMarketData } = require('./marketData');
const { computeSeries, evaluateAt, signalFromScore, MIN_CANDLES } = require('./strategy');
const { sizeBuy } = require('./risk');
const { FEE_RATE, SLIPPAGE } = require('./brokers/paperBroker');

// `series` lets callers (the optimizer) reuse computed indicators across runs,
// and `scores` (from scoreSeries) reuses the per-candle scores as well.
// `from`/`to` limit trading to part of the history; indicators before `from`
// still count as warm-up, so there is no look-ahead.
function backtest(candles, { startingBalance = 10000, risk = config.risk, strategy = config.strategy, series, scores, from = MIN_CANDLES, to = candles.length } = {}) {
  const s = series || computeSeries(candles);
  const start = Math.max(from, MIN_CANDLES);
  let cash = startingBalance;
  let pos = null; // { amount, entry, stopLoss, takeProfit, trailAtrMult, highest, cost }
  const trades = [];
  let peak = startingBalance;
  let maxDrawdown = 0;
  let exposureSum = 0;

  const close = (i, price, reason) => {
    const fill = price * (1 - SLIPPAGE);
    const proceeds = pos.amount * fill * (1 - FEE_RATE);
    cash += proceeds;
    trades.push({ entryTime: pos.time, exitTime: candles[i][0], entry: pos.entry, exit: fill, pnl: proceeds - pos.cost, reason });
    pos = null;
  };

  for (let i = start; i < to; i++) {
    const [, open, high, low, closePrice] = candles[i];

    // Stops are checked intra-bar against levels known before this bar. If
    // both levels fall inside one candle we assume the stop hit first (the
    // pessimistic case). A gap through the stop fills at the open.
    if (pos) {
      if (low <= pos.stopLoss) close(i, Math.min(pos.stopLoss, open), pos.trailAtrMult ? 'trailing stop' : 'stop-loss');
      else if (pos.takeProfit && high >= pos.takeProfit) close(i, Math.max(pos.takeProfit, open), 'take-profit');
    }
    // Trailing stop: ratchet up behind the highest price, never down.
    if (pos && pos.trailAtrMult) {
      pos.highest = Math.max(pos.highest, high);
      pos.stopLoss = Math.max(pos.stopLoss, pos.highest - pos.trailAtrMult * s.atr[i]);
    }

    const sig = scores ? signalFromScore(scores, i, s, strategy) : evaluateAt(s, i, strategy);
    if (!pos && sig.signal === 'BUY') {
      const { amount } = sizeBuy({ equity: cash, cash, price: closePrice, stopLoss: sig.stopLoss }, risk);
      if (amount > 0) {
        const fill = closePrice * (1 + SLIPPAGE);
        pos = {
          amount: (amount * (1 - FEE_RATE)) / fill,
          entry: fill,
          stopLoss: sig.stopLoss,
          takeProfit: sig.takeProfit,
          trailAtrMult: sig.trailAtrMult,
          highest: closePrice,
          cost: amount,
          time: candles[i][0],
        };
        cash -= amount;
      }
    } else if (pos && sig.signal === 'SELL') {
      close(i, closePrice, 'sell signal');
    }

    const equity = cash + (pos ? pos.amount * closePrice : 0);
    if (pos) exposureSum += (pos.amount * closePrice) / equity;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const last = candles[to - 1][4];
  const finalEquity = cash + (pos ? pos.amount * last : 0);
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl <= 0).reduce((a, t) => a + t.pnl, 0);

  return {
    grossWin,
    grossLoss,
    startingBalance,
    finalEquity,
    returnPct: ((finalEquity - startingBalance) / startingBalance) * 100,
    buyHoldPct: ((last - candles[start][4]) / candles[start][4]) * 100,
    exposurePct: (exposureSum / Math.max(to - start, 1)) * 100,
    trades: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDrawdown * 100,
    openPosition: Boolean(pos),
    tradeLog: trades,
  };
}

function parseArgs(argv) {
  const args = { bases: [], bars: 2000, timeframe: config.timeframe };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bars') args.bars = parseInt(argv[++i], 10);
    else if (argv[i] === '--timeframe') args.timeframe = argv[++i];
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
      `fees ${FEE_RATE * 100}% + slippage ${SLIPPAGE * 100}%\n`
  );

  const rows = [];
  for (const symbol of symbols) {
    try {
      const candles = await marketData.fetchHistory(symbol, args.timeframe, args.bars);
      if (candles.length <= MIN_CANDLES + 10) throw new Error(`only ${candles.length} candles returned`);
      const r = backtest(candles);
      const from = new Date(candles[MIN_CANDLES][0]).toISOString().slice(0, 10);
      const to = new Date(candles[candles.length - 1][0]).toISOString().slice(0, 10);
      rows.push({
        symbol,
        period: `${from} → ${to}`,
        'return %': r.returnPct.toFixed(2),
        'buy&hold %': r.buyHoldPct.toFixed(2),
        trades: r.trades,
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
  console.log('\nexposure % = average share of the account invested. Buy & hold is always 100%,');
  console.log('so compare return % against buy&hold % x exposure % / 100 for a like-for-like view.');
  console.log('Past performance does not guarantee future results.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { backtest };
