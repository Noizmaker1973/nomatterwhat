#!/usr/bin/env node
// fx-desk: paper-only. There is no order-placement code anywhere in this project.
import { loadConfig, loadRates, loadRatesHistory } from './config.js';
import { getCandles } from './data/index.js';
import { detectLatest } from './signals/breakout.js';
import { scoreSignal, summarize, withFee } from './signals/score.js';
import { backtestPair } from './signals/backtest.js';
import { momentumBacktest, momentumSignalAt, combine, stats, splitAt } from './signals/momentum.js';
import { roundTripCostPct } from './costs.js';
import { appendJsonl, readJsonl } from './journal.js';
import { makeFilter } from './fundamentals/filter.js';
import { carry, parseRatesHistory } from './fundamentals/rates.js';
import { fetchCot, pairPositioning } from './fundamentals/cot.js';
import { fetchCalendar, loadCalendar } from './fundamentals/calendar.js';
import { CONTRACTS, parsePair } from './pairs.js';
import { realizedVol, parkinsonVol, rvPercentile, logIv, ivRank } from './options/vol.js';
import { openPaperStrangle, scorePaperStrangle } from './options/paper.js';
import { stressPanel } from './options/stress.js';
import { breachStudy, currentRange } from './analysis/range.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    } else args._.push(a);
  }
  return args;
}

const pct = (x, d = 3) => (x == null || !Number.isFinite(x) ? 'n/a' : `${x.toFixed(d)}%`);
const usd = (x) => (x == null || !Number.isFinite(x) ? 'n/a' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const ratio = (x) => (x === Infinity ? 'inf' : x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(2));

function pairsFrom(args, config) {
  return args.pairs ? String(args.pairs).split(',').map((p) => parsePair(p).pair) : Object.keys(config.pairs);
}

function dataOpts(args) {
  const o = {};
  if (args.source) o.source = args.source;
  if (args.days) o.days = Number(args.days);
  if (args.bars) o.bars = Number(args.bars);
  if (args.seed) o.seed = Number(args.seed);
  return o;
}

function printSummary(label, s) {
  if (!s.n) return console.log(`${label.padEnd(26)} no trades`);
  console.log(
    `${label.padEnd(26)} n=${String(s.n).padStart(4)}  win=${(s.winRate * 100).toFixed(1).padStart(5)}%  ` +
      `avgWin=${pct(s.avgWinPct)}  avgLoss=${pct(s.avgLossPct)}  exp=${pct(s.expectancyPct, 4)}  PF=${ratio(s.profitFactor)}  total=${pct(s.totalPct, 2)}`,
  );
}

function buildFilter(config, args) {
  if (args['no-filter']) return null;
  return makeFilter(config, { rates: loadRates(), calendar: loadCalendar() });
}

async function cmdScan(args, config) {
  const tf = args.tf ?? config.timeframe;
  const seen = new Set(readJsonl('signals').map((s) => s.id));
  const filter = buildFilter(config, args);
  for (const pair of pairsFrom(args, config)) {
    try {
      const candles = await getCandles(pair, tf, config, dataOpts(args));
      const sig = detectLatest(candles, config.strategy, { pair, tf });
      if (!sig) {
        console.log(`${pair}: no signal (last close ${new Date(candles.at(-1).t).toISOString()})`);
        continue;
      }
      if (seen.has(sig.id)) {
        console.log(`${pair}: ${sig.side} already logged`);
        continue;
      }
      const verdict = filter ? filter(sig) : { allowed: true, reasons: [], tags: {} };
      const record = {
        ...sig,
        feePct: roundTripCostPct(pair, sig.refPrice, config),
        blocked: !verdict.allowed,
        filterReasons: verdict.reasons,
        fundamentals: verdict.tags,
        loggedAt: new Date().toISOString(),
        paper: true,
      };
      appendJsonl('signals', record);
      console.log(
        `${pair}: ${sig.side.toUpperCase()} @ ${sig.refPrice}  stop ${pct(sig.stopPct)}  target ${pct(sig.targetPct)}  ` +
          `fee ${pct(record.feePct, 4)}${record.blocked ? `  [BLOCKED: ${verdict.reasons.join('; ')}]` : ''}`,
      );
    } catch (e) {
      console.error(`${pair}: ${e.message}`);
    }
  }
}

async function cmdScore(args, config) {
  const done = new Set(readJsonl('outcomes').map((o) => o.id));
  const open = readJsonl('signals').filter((s) => !done.has(s.id));
  const byKey = new Map();
  let scored = 0;
  for (const sig of open) {
    const key = `${sig.pair}-${sig.tf}`;
    if (!byKey.has(key)) {
      try {
        byKey.set(key, await getCandles(sig.pair, sig.tf, config, dataOpts(args)));
      } catch (e) {
        console.error(`${key}: ${e.message}`);
        byKey.set(key, null);
      }
    }
    const candles = byKey.get(key);
    if (!candles) continue;
    const res = scoreSignal(sig, candles, sig.feePct);
    if (!res) continue;
    appendJsonl('outcomes', { ...res, blocked: sig.blocked, scoredAt: new Date().toISOString() });
    scored++;
  }
  console.log(`Scored ${scored} signal(s); ${open.length - scored} still open.`);
  cmdReport(args, config);
}

function cmdReport(args, config) {
  const outs = readJsonl('outcomes');
  if (!outs.length) return console.log('No outcomes yet. Run `scan` on a schedule, then `score`.');
  const taken = outs.filter((o) => !o.blocked);
  const blocked = outs.filter((o) => o.blocked);
  console.log('\nPaper signal results (net of modeled spread):');
  printSummary('taken', summarize(taken));
  printSummary('blocked by filter', summarize(blocked));
  for (const fee of config.backtest.compareFeePct) printSummary(`taken @ ${fee}% fee`, summarize(withFee(taken, fee)));
  const pairs = [...new Set(outs.map((o) => o.pair))];
  for (const p of pairs) printSummary(`  ${p}`, summarize(taken.filter((o) => o.pair === p)));
}

async function cmdBacktest(args, config) {
  if (args.tf) config.timeframe = args.tf;
  const filter = args.filter ? buildFilter(config, args) : null;
  const all = [];
  const allBlocked = [];
  console.log(`Backtest ${config.timeframe}, source=${args.source ?? config.data.source}${filter ? ', fundamentals filter ON' : ''}`);
  for (const pair of pairsFrom(args, config)) {
    try {
      const candles = await getCandles(pair, config.timeframe, config, dataOpts(args));
      const { outcomes, blocked } = backtestPair(pair, candles, config, filter);
      all.push(...outcomes);
      allBlocked.push(...blocked);
      const span = `${new Date(candles[0].t).toISOString().slice(0, 10)}..${new Date(candles.at(-1).t).toISOString().slice(0, 10)}`;
      printSummary(`${pair} (${span})`, summarize(outcomes));
    } catch (e) {
      console.error(`${pair}: ${e.message}`);
    }
  }
  console.log('\nSame signals, different cost assumptions:');
  printSummary('gross (no cost)', summarize(all, 'grossPct'));
  printSummary('real FX spread', summarize(all));
  for (const fee of config.backtest.compareFeePct) printSummary(`${fee}% round trip`, summarize(withFee(all, fee)));
  if (filter) printSummary('blocked by filter', summarize(allBlocked));
  const avgFee = all.length ? all.reduce((s, o) => s + o.feePct, 0) / all.length : 0;
  console.log(`\nAvg modeled FX round-trip cost: ${pct(avgFee, 4)}`);
  if (args.source === 'synthetic' || (!args.source && config.data.source === 'synthetic'))
    console.log('NOTE: synthetic data checks the plumbing only. It says nothing about real edge.');
}

async function cmdFundamentals(args, config) {
  const sub = args._[1] ?? 'show';
  if (sub === 'update') {
    try {
      const ev = await fetchCalendar(config.fundamentals.calendarUrl);
      console.log(`Calendar: ${ev.length} events stored`);
    } catch (e) {
      console.error(`Calendar: ${e.message}`);
    }
    for (const ccy of ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']) {
      try {
        const rows = await fetchCot(ccy);
        console.log(`COT ${ccy}: ${rows.length} weeks`);
      } catch (e) {
        console.error(`COT ${ccy}: ${e.message}`);
      }
    }
    return;
  }
  const rates = loadRates();
  if (!rates.asOf) console.log('WARNING: config/rates.json has placeholder rates (asOf is null). Update it before relying on carry.\n');
  const cal = loadCalendar();
  const now = Date.now();
  for (const pair of pairsFrom(args, config)) {
    const c = carry(pair, rates, { maxAgeDays: config.fundamentals.ratesMaxAgeDays });
    const p = pairPositioning(pair);
    const { base, quote } = parsePair(pair);
    const next = cal?.find((e) => e.t > now && e.impact === 'High' && (e.currency === base || e.currency === quote));
    console.log(
      `${pair}: carry ${c ? `${c.diffPct >= 0 ? '+' : ''}${c.diffPct.toFixed(2)}% (${c.diffPct >= 0 ? 'long' : 'short'} earns)${c.stale ? ' [stale]' : ''}` : 'n/a'}` +
        ` | COT pair index ${p ? p.pairIndex.toFixed(0) : 'n/a (run fundamentals update)'}` +
        ` | next high-impact: ${next ? `${next.currency} ${next.title} ${new Date(next.t).toISOString()}` : 'none loaded'}`,
    );
  }
}

async function optionsContext(args, config) {
  const pair = parsePair(args.pair ?? 'EURUSD').pair;
  const info = parsePair(pair);
  if (!info.future) throw new Error(`${pair} has no CME FX future mapping`);
  const daily = await getCandles(pair, '1d', config, { ...dataOpts(args), days: undefined });
  const spot = args.spot ? Number(args.spot) : daily.at(-1).c;
  const rv20 = realizedVol(daily, 20);
  if (args.iv == null && rv20 == null) throw new Error('Need --iv (or enough daily history for an RV proxy)');
  const ivPct = args.iv != null ? Number(args.iv) : rv20 * 100 * 1.1;
  return { pair, info, daily, spot, ivPct, ivIsProxy: args.iv == null };
}

async function cmdOptions(args, config) {
  const sub = args._[1] ?? 'analyze';
  const rates = loadRates();
  if (sub === 'log-iv') {
    const info = parsePair(args.pair ?? 'EURUSD');
    if (args.iv == null) throw new Error('--iv required (in vol points, e.g. 7.4)');
    logIv(info.future, Number(args.iv), args.date);
    return console.log(`Logged ${info.future} IV ${args.iv}`);
  }
  if (sub === 'score') {
    const done = new Set(readJsonl('strangleOutcomes').map((o) => o.id));
    const open = readJsonl('strangles').filter((s) => !done.has(s.id));
    for (const s of open) {
      const daily = await getCandles(s.pair, '1d', config, dataOpts(args));
      const res = scorePaperStrangle(s, daily, config, rates);
      if (!res) {
        console.log(`${s.id}: open until ${s.expiry}`);
        continue;
      }
      appendJsonl('strangleOutcomes', res);
      console.log(`${s.id}: held ${usd(res.heldToExpiryPnlUsd)}, with stop ${usd(res.withStopPnlUsd)}, worst mark ${usd(res.worstMarkPnlUsd)}`);
    }
    const outs = readJsonl('strangleOutcomes');
    if (outs.length) {
      const sum = (k) => outs.reduce((a, o) => a + o[k], 0);
      const wins = outs.filter((o) => o.heldToExpiryPnlUsd > 0).length;
      console.log(
        `\nPaper strangles: n=${outs.length}  win=${((wins / outs.length) * 100).toFixed(0)}%  held total ${usd(sum('heldToExpiryPnlUsd'))}  ` +
          `with stop ${usd(sum('withStopPnlUsd'))}  worst single ${usd(Math.min(...outs.map((o) => o.heldToExpiryPnlUsd)))}`,
      );
    }
    return;
  }

  const ctx = await optionsContext(args, config);
  const delta = Number(args.delta ?? 0.16);
  const dte = Number(args.dte ?? 30);
  const contracts = Number(args.contracts ?? 1);
  const s = openPaperStrangle({ pair: ctx.pair, spot: ctx.spot, ivPct: ctx.ivPct, dte, delta, contracts, config, rates });
  const contract = CONTRACTS[s.future];

  if (sub === 'paper-open') {
    if (ctx.ivIsProxy && !args['allow-proxy-iv']) throw new Error('Refusing to log a paper strangle on proxy IV. Pass --iv from your broker/CME, or --allow-proxy-iv.');
    appendJsonl('strangles', { ...s, ivIsProxy: ctx.ivIsProxy, paper: true });
    if (!ctx.ivIsProxy) logIv(s.future, ctx.ivPct);
    console.log(`Logged paper strangle ${s.id}: ${s.putStrike}P / ${s.callStrike}C, credit ${usd(s.creditUsd)}, margin est ${usd(s.marginUsd)}`);
    return;
  }

  const rank = ivRank(s.future, ctx.ivPct);
  const rvp = rvPercentile(ctx.daily);
  const rv10 = realizedVol(ctx.daily, 10);
  const rv20 = realizedVol(ctx.daily, 20);
  const rv60 = realizedVol(ctx.daily, 60);
  const pk20 = parkinsonVol(ctx.daily, 20);
  const stress = stressPanel(s, contract, config.options);

  console.log(`\n${ctx.pair} -> ${s.future} (${contract.name}), ${contracts} contract(s), ${dte} DTE, ${delta} delta`);
  console.log(`Spot ${ctx.spot.toPrecision(6)}  ->  future est ${s.F.toPrecision(6)} (carry-adjusted${rates.asOf ? '' : ', PLACEHOLDER rates'})`);
  console.log(`\nVolatility`);
  console.log(`  IV used        ${ctx.ivPct.toFixed(2)}${ctx.ivIsProxy ? '  [PROXY = 1.1 x RV20; pass --iv for real analysis]' : ''}`);
  console.log(`  RV 10/20/60    ${[rv10, rv20, rv60].map((v) => (v == null ? 'n/a' : (v * 100).toFixed(2))).join(' / ')}   Parkinson20 ${pk20 == null ? 'n/a' : (pk20 * 100).toFixed(2)}`);
  console.log(`  IV - RV20      ${rv20 == null ? 'n/a' : (ctx.ivPct - rv20 * 100).toFixed(2)} vol pts ${rv20 != null && ctx.ivPct > rv20 * 100 ? '(premium is rich vs realized)' : '(premium is NOT rich vs realized)'}`);
  console.log(`  IV rank        ${rank.rank == null ? `n/a (${rank.n} IV records; log daily with \`options log-iv\`)` : `${(rank.rank * 100).toFixed(0)} (pctile ${(rank.percentile * 100).toFixed(0)}, ${rank.n} days)`}`);
  if (rvp) console.log(`  RV20 pctile    ${(rvp.percentile * 100).toFixed(0)} over last year (range ${(rvp.min * 100).toFixed(1)}-${(rvp.max * 100).toFixed(1)})`);
  console.log(`\nStrangle`);
  console.log(`  Expected move  +-${s.expectedMove.toPrecision(4)} (${s.expectedMovePct.toFixed(2)}%) by expiry`);
  console.log(`  Short put      ${s.putStrike}  (delta ${s.putDelta.toFixed(3)})`);
  console.log(`  Short call     ${s.callStrike}  (delta ${s.callDelta.toFixed(3)})`);
  console.log(`  Credit         ${usd(s.creditUsd)}  after ${config.options.slippageTicksPerLeg} tick/leg slippage and ${usd(s.feesOpen)} fees`);
  console.log(`  Breakevens     ${s.breakevenDown.toPrecision(6)} / ${s.breakevenUp.toPrecision(6)}`);
  console.log(`  P(expire OTM)  ${(s.popOtm * 100).toFixed(1)}%   P(profit at expiry) ${(s.popProfit * 100).toFixed(1)}%   (lognormal; real FX tails are fatter)`);
  console.log(`  Theta/day      ${usd(s.netThetaUsd)}   Vega/pt ${usd(s.netVega)}`);
  console.log(`  Margin est     ${usd(s.marginUsd)} now, ${usd(stress.stressedMarginUsd)} after a bad day (+1 sd move, IV x1.5)`);
  console.log(`  Credit/margin  ${pct((s.creditUsd / s.marginUsd) * 100, 1)}`);
  console.log(`\nStress (P&L per position)                         at expiry     now w/ IV shock   credits lost`);
  for (const r of stress.rows) {
    console.log(`  ${r.scenario.padEnd(46)} ${pct(r.movePct, 2).padStart(8)} ${usd(r.pnlAtExpiry).padStart(12)} ${usd(r.pnlNowIvShock).padStart(16)} ${r.creditsLost == null ? '' : r.creditsLost.toFixed(1).padStart(10)}`);
  }
  console.log('\nModel output for paper trading; not a recommendation. Verify quotes, margin and contract specs with your broker.');
}


function printMomStats(label, st) {
  if (!st || st.n < 20) return console.log(`${label.padEnd(24)} not enough data`);
  console.log(
    `${label.padEnd(24)} ${st.years.toFixed(1).padStart(4)}y  ret/yr=${pct(st.annReturnPct, 2).padStart(7)}  vol=${pct(st.annVolPct, 1).padStart(6)}  ` +
      `Sharpe=${st.sharpe.toFixed(2).padStart(5)}  t=${st.tStat.toFixed(2).padStart(5)}  maxDD=${pct(st.maxDrawdownPct, 1).padStart(7)}  ` +
      `turnover=${st.turnoverPerYear.toFixed(1)}x/yr  cost=${pct(st.costDragPctPerYear, 3)}/yr`,
  );
}

async function cmdMomentum(args, config) {
  const sub = args._[1] ?? 'backtest';
  const p = config.momentum;
  const ratesHistory = args['no-carry'] ? null : loadRatesHistory(parseRatesHistory);
  const pairs = pairsFrom(args, config);
  const daily = {};
  for (const pair of pairs) {
    try {
      daily[pair] = await getCandles(pair, '1d', config, { ...dataOpts(args), days: undefined });
    } catch (e) {
      console.error(`${pair}: ${e.message}`);
    }
  }

  if (sub === 'now') {
    console.log(`Momentum targets (position as a multiple of equity, vol target ${p.targetVol * 100}%/pair):`);
    for (const [pair, candles] of Object.entries(daily)) {
      const sig = momentumSignalAt(candles, candles.length - 1, p, ratesHistory, pair);
      if (!sig) {
        console.log(`${pair}: not enough history`);
        continue;
      }
      const rec = { pair, date: new Date(sig.t).toISOString().slice(0, 10), price: sig.price, signal: sig.signal, vol: sig.vol, position: sig.position, carryDiff: sig.carryDiff, loggedAt: new Date().toISOString(), paper: true };
      if (!args['no-log']) appendJsonl('momentum.jsonl', rec);
      const side = sig.position > 0 ? 'LONG ' : sig.position < 0 ? 'SHORT' : 'FLAT ';
      console.log(`${pair}: ${side} ${sig.position.toFixed(2)}x  (lookback signs ${sig.parts.map((x) => (x > 0 ? '+' : x < 0 ? '-' : '0')).join('')}, vol ${(sig.vol * 100).toFixed(1)}%, close ${rec.date})`);
    }
    return;
  }

  if (sub === 'paper') {
    const log = readJsonl('momentum.jsonl');
    if (!log.length) return console.log('No snapshots yet. Run `momentum now` on each rebalance day.');
    let total = 0;
    for (const pair of [...new Set(log.map((r) => r.pair))]) {
      const snaps = log.filter((r) => r.pair === pair);
      const candles = daily[pair];
      if (!candles) continue;
      let pnl = 0;
      for (let k = 0; k < snaps.length; k++) {
        const from = snaps[k];
        const toPrice = k + 1 < snaps.length ? snaps[k + 1].price : candles.at(-1).c;
        const cost = roundTripCostPct(pair, from.price, config) / 2 / 100;
        const prev = k ? snaps[k - 1].position : 0;
        pnl += from.position * (toPrice / from.price - 1) - Math.abs(from.position - prev) * cost;
      }
      total += pnl;
      console.log(`${pair}: ${snaps.length} snapshot(s), paper return ${pct(pnl * 100, 2)} on equity`);
    }
    return console.log(`Equal-weight paper return: ${pct((total / Object.keys(daily).length) * 100, 2)}`);
  }

  console.log(`Momentum backtest, daily, source=${args.source ?? config.data.source}`);
  console.log(`Rule: lookbacks ${p.lookbacks.join('/')}d, vol ${p.volWindow}d -> ${p.targetVol * 100}% target, max ${p.maxLeverage}x, rebalance every ${p.rebalanceDays}d, lag ${p.executionLagDays}d, carry ${ratesHistory && p.carryWeight ? `weight ${p.carryWeight}` : ratesHistory ? 'accrued only' : 'NOT included (no config/rates-history.csv)'}`);
  console.log(`In-sample < ${p.outOfSampleStart} <= out-of-sample. Judge on in-sample; look at out-of-sample once.\n`);
  const byFee = { gross: {}, spread: {} };
  for (const fee of config.backtest.compareFeePct) byFee[`${fee}%`] = {};
  for (const [pair, candles] of Object.entries(daily)) {
    const spread = roundTripCostPct(pair, candles.at(-1).c, config);
    byFee.gross[pair] = momentumBacktest(pair, candles, p, { costPct: 0, ratesHistory });
    byFee.spread[pair] = momentumBacktest(pair, candles, p, { costPct: spread, ratesHistory });
    for (const fee of config.backtest.compareFeePct) byFee[`${fee}%`][pair] = momentumBacktest(pair, candles, p, { costPct: fee, ratesHistory });
    const { inSample, outOfSample } = splitAt(byFee.spread[pair], p.outOfSampleStart);
    printMomStats(`${pair} in-sample`, stats(inSample));
    printMomStats(`${pair} out-of-sample`, stats(outOfSample));
  }
  for (const [half, label] of [['inSample', 'IN-SAMPLE'], ['outOfSample', 'OUT-OF-SAMPLE']]) {
    console.log(`\nEqual-weight portfolio, ${label}:`);
    printMomStats('gross (no cost)', stats(splitAt(combine(byFee.gross), p.outOfSampleStart)[half], 'gross'));
    printMomStats('real FX spread', stats(splitAt(combine(byFee.spread), p.outOfSampleStart)[half]));
    for (const fee of config.backtest.compareFeePct) printMomStats(`${fee}% round trip`, stats(splitAt(combine(byFee[`${fee}%`]), p.outOfSampleStart)[half]));
  }
  console.log('\nRough guide: |t| < 2 is indistinguishable from luck. Spot returns exclude interest unless a rate history is supplied.');
}

async function cmdRange(args, config) {
  const rc = config.range;
  const days = Number(args.days ?? rc.days);
  const bufferAtr = Number(args['buffer-atr'] ?? rc.bufferAtr);
  const horizons = rc.horizons;
  const sortH = Number(args.horizon ?? rc.sortHorizon);
  const list = args.pair ? String(args.pair) : args.pairs ? String(args.pairs) : null;
  const pairs = list ? list.split(',').map((p) => parsePair(p).pair) : rc.pairs;
  const recentSince = Date.now() - rc.recentYears * 365 * 86400e3;
  const rows = [];
  for (const pair of pairs) {
    try {
      const candles = await getCandles(pair, '1d', config, { ...dataOpts(args), days: undefined });
      const cur = currentRange(candles, days);
      if (!cur) throw new Error('not enough history');
      const opts = { days, horizons, bufferAtr };
      rows.push({ pair, candles, cur, all: breachStudy(candles, opts), recent: breachStudy(candles, { ...opts, since: recentSince }) });
    } catch (e) {
      console.error(`${pair}: ${e.message}`);
    }
  }
  if (!rows.length) return;
  const span = (c) => `${new Date(c[0].t).toISOString().slice(0, 10)}..${new Date(c.at(-1).t).toISOString().slice(0, 10)}`;
  const f = (x, d = 1) => (x == null ? 'n/a' : x.toFixed(d));
  const p100 = (x) => (x == null ? '  n/a' : `${(x * 100).toFixed(0)}%`.padStart(5));

  if (args.pair) {
    const r = rows[0];
    const c = r.cur;
    console.log(`\n${r.pair}  (${span(r.candles)}, ${days}-day range, buffer ${bufferAtr} ATR)`);
    console.log(`Now: ${c.low.toPrecision(5)} - ${c.high.toPrecision(5)}  width ${f(c.widthPct, 2)}% = ${f(c.widthAtr)} ATR  last ${c.last.toPrecision(5)} (${f(c.position * 100, 0)}% up the range)`);
    console.log(`     efficiency ${f(c.efficiency, 2)} (0 chop .. 1 trend)  variance ratio ${f(c.varianceRatio, 2)} (<1 mean-reverting, >1 trending)\n`);
    console.log('If you had sold outside the prior range on every day:');
    console.log('horizon  period    days  touched  closed outside  (up/down)   overshoot when outside: median   p95    max');
    for (const h of horizons) {
      for (const [label, st] of [['all', r.all[h]], [`last ${rc.recentYears}y`, r.recent[h]]]) {
        console.log(
          `${`${h}d`.padEnd(8)} ${label.padEnd(8)} ${String(st.n).padStart(5)}    ${p100(st.touchRate)}      ${p100(st.expireRate)}       ${p100(st.upShare)}/${p100(st.downShare).trim()}` +
            `                  ${f(st.overshootMedianPct, 2).padStart(5)}%  ${f(st.overshootP95Pct, 2).padStart(5)}%  ${f(st.overshootMaxPct, 2).padStart(5)}%`,
        );
      }
    }
    console.log('\nDays overlap, so the effective sample is much smaller than "days". Past breach rates are not a forecast.');
    return;
  }

  rows.sort((a, b) => a.all[sortH].expireRate - b.all[sortH].expireRate);
  console.log(`\nRange scan: ${days}-day high/low, buffer ${bufferAtr} ATR, sorted by how often price CLOSED outside it ${sortH} days later (all history).`);
  console.log('pair     width%  width/ATR  pos  effic  VR    | touched  closed-out  closed-out   p95 overshoot');
  console.log(`                                              | ${`${sortH}d all`.padEnd(8)} ${`${sortH}d all`.padEnd(11)} ${`${sortH}d ${rc.recentYears}y`.padEnd(11)}  when out`);
  for (const r of rows) {
    const c = r.cur;
    const a = r.all[sortH];
    console.log(
      `${r.pair}  ${f(c.widthPct, 2).padStart(6)}  ${f(c.widthAtr).padStart(9)}  ${f(c.position * 100, 0).padStart(3)}%  ${f(c.efficiency, 2).padStart(5)}  ${f(c.varianceRatio, 2).padStart(4)}  |   ${p100(a.touchRate)}      ${p100(a.expireRate)}       ${p100(r.recent[sortH].expireRate)}      ${f(a.overshootP95Pct, 2).padStart(5)}%`,
    );
  }
  console.log('\nwidth/pos/effic/VR describe the CURRENT range. Lower effic and VR < 1 = choppier, more range-like.');
  console.log('Use --pair AUDNZD for every horizon, --days N to change the range, --buffer-atr 1 to put "strikes" 1 ATR outside it.');
}

const HELP = `fx-desk (paper only)

  scan       [--pairs EURUSD,GBPUSD] [--tf 1h] [--source yahoo|oanda|csv|synthetic] [--no-filter]
  score      score logged signals that have resolved, then print the report
  report     summary of outcomes.jsonl
  backtest   [--pairs ..] [--tf 1h] [--source ..] [--filter]   real spread vs 0.3% fee on the same signals
  fundamentals [show|update]                                carry, COT positioning, next high-impact event
  options analyze    --pair EURUSD [--iv 7.5] [--dte 30] [--delta 0.16] [--contracts 1] [--spot 1.08]
  options paper-open (same args; --iv required)            log a paper strangle
  options score                                            settle expired paper strangles
  options log-iv     --pair EURUSD --iv 7.5 [--date YYYY-MM-DD]   build IV rank history
  momentum backtest  [--pairs ..] [--source ..] [--no-carry]  daily trend-following, in- vs out-of-sample
  momentum now       current target positions (logs a paper snapshot; --no-log to skip)
  momentum paper     P&L of logged snapshots
  range              [--pairs ..] [--pair X] [--days 60] [--buffer-atr 0] [--horizon 10]   which pairs are ranging, and how often ranges break
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const cmd = args._[0];
  const cmds = { scan: cmdScan, score: cmdScore, report: cmdReport, backtest: cmdBacktest, fundamentals: cmdFundamentals, options: cmdOptions, momentum: cmdMomentum, range: cmdRange };
  if (!cmds[cmd]) return console.log(HELP);
  await cmds[cmd](args, config);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
