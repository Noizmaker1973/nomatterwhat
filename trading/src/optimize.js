// Optimizer: tries many strategy settings on historical data and reports the
// ones that held up.
//
// To avoid settings that only fit the past, history is split in two:
//   training (first 2/3) - every combination is ranked here
//   testing  (last 1/3)  - the top combinations are re-run on data they were
//                          never chosen on. Only these numbers mean anything.
//
//   npm run optimize
//   npm run optimize -- BTC ETH --bars 4000 --timeframes 1h,4h --train 0.7

const config = require('./config');
const { createMarketData } = require('./marketData');
const { computeSeries, scoreSeries, MIN_CANDLES } = require('./strategy');
const { backtest } = require('./backtest');

const GRID = {
  classic: { buyThreshold: [2, 3, 4, 5], sellThreshold: [-2, -3, -4], stopAtrMult: [1.5, 2, 3], targetAtrMult: [2, 3, 4, 6] },
  trend: { buyThreshold: [2, 3, 4, 5], sellThreshold: [-2, -3, -4], stopAtrMult: [1.5, 2, 3], trailAtrMult: [2, 3, 4, 5] },
};
const MIN_TRADES_PER_COIN = 3; // fewer trades than this is luck, not a result

function combinations(grid) {
  return Object.entries(grid).reduce(
    (acc, [key, values]) => acc.flatMap((combo) => values.map((v) => ({ ...combo, [key]: v }))),
    [{}]
  );
}

// Runs one setting on every coin over [from, to) and combines the results as
// if the account were split equally between the coins.
function evaluate(datasets, strategy, window) {
  let returnSum = 0;
  let buyHoldSum = 0;
  let exposureSum = 0;
  let trades = 0;
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let worstDrawdown = 0;
  for (const d of datasets) {
    const r = backtest(d.candles, { series: d.series, scores: d.scores[strategy.mode], strategy, ...window(d) });
    returnSum += r.returnPct;
    buyHoldSum += r.buyHoldPct;
    exposureSum += r.exposurePct;
    trades += r.trades;
    wins += Math.round((r.winRatePct / 100) * r.trades);
    grossWin += r.grossWin;
    grossLoss += r.grossLoss;
    worstDrawdown = Math.max(worstDrawdown, r.maxDrawdownPct);
  }
  const n = datasets.length;
  return {
    returnPct: returnSum / n,
    buyHoldPct: buyHoldSum / n,
    exposurePct: exposureSum / n,
    trades,
    winRatePct: trades ? (wins / trades) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: worstDrawdown,
  };
}

// Short form, e.g. "trend 4/-2 s2 tr3" = buy at 4, sell at -2, stop 2 ATR, trail 3 ATR.
const describe = (st) =>
  st.mode === 'trend'
    ? `trend   ${st.buyThreshold}/${st.sellThreshold} s${st.stopAtrMult} tr${st.trailAtrMult}`
    : `classic ${st.buyThreshold}/${st.sellThreshold} s${st.stopAtrMult} tg${st.targetAtrMult}`;

const pf = (v) => (Number.isFinite(v) ? v.toFixed(2) : 'inf');

function row(label, tf, train, test) {
  return [
    label,
    tf,
    train.returnPct.toFixed(2),
    pf(train.profitFactor),
    test.returnPct.toFixed(2),
    pf(test.profitFactor),
    String(test.trades),
    test.winRatePct.toFixed(0),
    test.maxDrawdownPct.toFixed(1),
    test.exposurePct.toFixed(1),
    test.buyHoldPct.toFixed(1),
  ];
}

// A compact plain-text table that fits a normal terminal window.
function printTable(rows) {
  const header = [
    ['setting', ''], ['tf', ''], ['train', 'ret%'], ['train', 'PF'], ['TEST', 'ret%'], ['TEST', 'PF'],
    ['TEST', 'trades'], ['TEST', 'win%'], ['TEST', 'maxDD%'], ['TEST', 'expo%'], ['TEST', 'b&h%'],
  ];
  const widths = header.map((h, c) => Math.max(h[0].length, h[1].length, ...rows.map((r) => r[c].length)));
  const line = (cells, sep = '  ') => cells.map((v, c) => (c < 2 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join(sep);
  console.log(line(header.map((h) => h[0])));
  console.log(line(header.map((h) => h[1])));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  let lastTf = null;
  for (const r of rows) {
    if (lastTf && r[1] !== lastTf) console.log('');
    lastTf = r[1];
    console.log(line(r));
  }
}

// Ranks every combination on the training window. Returns the best few.
function optimize(datasets, { top = 5 } = {}) {
  const trainWindow = (d) => ({ from: MIN_CANDLES, to: d.split });
  const testWindow = (d) => ({ from: d.split, to: d.candles.length });
  const minTrades = MIN_TRADES_PER_COIN * datasets.length;

  const ranked = [];
  for (const mode of Object.keys(GRID)) {
    for (const combo of combinations(GRID[mode])) {
      const strategy = { mode, ...combo };
      const train = evaluate(datasets, strategy, trainWindow);
      if (train.trades < minTrades) continue;
      ranked.push({ strategy, train });
    }
  }
  // Highest training return first; profit factor breaks ties.
  ranked.sort((a, b) => b.train.returnPct - a.train.returnPct || b.train.profitFactor - a.train.profitFactor);
  const best = ranked.slice(0, top).map((r) => ({ ...r, test: evaluate(datasets, r.strategy, testWindow) }));
  return { best, tried: ranked.length, evaluate: (strategy) => ({
    train: evaluate(datasets, strategy, trainWindow),
    test: evaluate(datasets, strategy, testWindow),
  }) };
}

function parseArgs(argv) {
  const args = { bases: [], bars: 3000, timeframes: ['1h', '4h'], train: 2 / 3 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--bars') args.bars = parseInt(argv[++i], 10);
    else if (argv[i] === '--timeframes') args.timeframes = argv[++i].split(',').map((t) => t.trim());
    else if (argv[i] === '--train') args.train = parseFloat(argv[++i]);
    else if (argv[i] === '--demo') continue; // handled in config.js
    else args.bases.push(argv[i].toUpperCase());
  }
  return args;
}

async function loadDatasets(marketData, symbols, timeframe, bars, trainShare) {
  const datasets = [];
  for (const symbol of symbols) {
    const candles = await marketData.fetchHistory(symbol, timeframe, bars);
    if (candles.length < MIN_CANDLES + 100) {
      console.log(`  ${symbol} ${timeframe}: only ${candles.length} candles, skipped`);
      continue;
    }
    const series = computeSeries(candles);
    datasets.push({
      symbol,
      candles,
      series,
      scores: { classic: scoreSeries(series, 'classic'), trend: scoreSeries(series, 'trend') },
      split: MIN_CANDLES + Math.floor((candles.length - MIN_CANDLES) * trainShare),
    });
  }
  return datasets;
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.bases.length ? args.bases.map((b) => `${b}/${config.quote}`) : config.symbols;
  const marketData = createMarketData(config);
  const perMode = Object.values(GRID).map((g) => combinations(g).length);
  console.log(`Optimizer | ${marketData.name} | ${symbols.join(', ')} | ${args.bars} bars per timeframe`);
  console.log(`Trying ${perMode.reduce((a, b) => a + b)} settings per timeframe, ranked on the first ${Math.round(args.train * 100)}% of history, checked on the rest.\n`);

  const current = { ...config.strategy };
  const rows = [];
  let overall = null;

  for (const tf of args.timeframes) {
    process.stdout.write(`Loading ${tf} history... `);
    const datasets = await loadDatasets(marketData, symbols, tf, args.bars, args.train);
    if (!datasets.length) {
      console.log('no data');
      continue;
    }
    const d0 = datasets[0];
    console.log(
      `train ${day(d0.candles[MIN_CANDLES][0])} → ${day(d0.candles[d0.split - 1][0])}, ` +
        `test ${day(d0.candles[d0.split][0])} → ${day(d0.candles[d0.candles.length - 1][0])}`
    );

    const result = optimize(datasets);
    const now = result.evaluate(current);
    rows.push(row(`now ${describe(current)}`, tf, now.train, now.test));
    result.best.forEach((r, k) => {
      rows.push(row(`#${k + 1}  ${describe(r.strategy)}`, tf, r.train, r.test));
      // Pick between timeframes by training profit factor: it is comparable
      // across different date ranges, and choosing by test results would let
      // the test data leak into the decision.
      if (k === 0 && (!overall || r.train.profitFactor > overall.train.profitFactor)) overall = { ...r, tf };
    });
  }

  console.log('');
  printTable(rows);
  console.log('');
  console.log('setting: "now" = your current settings, #1-#5 = best found. "trend 4/-2 s2 tr3" means');
  console.log('  trend mode, buy at score 4, sell at -2, stop 2 ATR, trail 3 ATR (tg = fixed target, classic).');
  console.log('ret% = whole-account return, coins split equally. PF = profit factor (above 1 = profitable).');
  console.log('expo% = average share of the account invested. b&h% = buy and hold over the same period.');
  console.log('Settings were chosen on TRAIN only. TEST is data they never saw: the honest score.\n');

  if (!overall) return;
  const t = overall.test;
  const holds = t.returnPct > 0 && t.profitFactor > 1 && t.trades >= MIN_TRADES_PER_COIN * symbols.length;
  if (holds) {
    console.log(`Best setting held up on unseen data: ${t.returnPct.toFixed(2)}% return, profit factor ${pf(t.profitFactor)}.`);
    console.log('To paper trade it, put these lines in your .env and restart:\n');
  } else {
    console.log('WARNING: even the best setting did NOT hold up on unseen data');
    console.log(`(test return ${t.returnPct.toFixed(2)}%, profit factor ${pf(t.profitFactor)}, ${t.trades} trades).`);
    console.log('Do not trade it with real money. If you want to paper trade it anyway, the .env lines are:\n');
  }
  const st = overall.strategy;
  console.log(`  TIMEFRAME=${overall.tf}`);
  console.log(`  STRATEGY_MODE=${st.mode}`);
  console.log(`  BUY_THRESHOLD=${st.buyThreshold}`);
  console.log(`  SELL_THRESHOLD=${st.sellThreshold}`);
  console.log(`  STOP_ATR_MULT=${st.stopAtrMult}`);
  if (st.mode === 'trend') console.log(`  TRAIL_ATR_MULT=${st.trailAtrMult}`);
  else console.log(`  TARGET_ATR_MULT=${st.targetAtrMult}`);
  console.log('\nPast performance does not guarantee future results.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { optimize, combinations, GRID };
