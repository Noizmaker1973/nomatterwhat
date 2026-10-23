# fx-desk

Paper-only FX research desk. It has three parts that share only the underlying prices:

1. **Spot signal engine.** The compression → breakout scanner, priced with real FX spreads instead of a 0.3% crypto fee, with `signals.jsonl` / `outcomes.jsonl` scoring.
2. **Options analytics** for CME options on FX futures (6E, 6B, 6J, 6A, 6C, 6S). It covers IV vs realized vol, IV rank, expected move, strikes picked by delta, a SPAN-style margin estimate, a stress panel, and paper strangle logging.
3. **Fundamentals filter.** Rate differentials, CFTC COT positioning and an economic calendar blackout act as a *filter* on technical signals, never as a signal source.

There is no order-placement code anywhere in this project. Every adapter is read-only.

> Not financial advice. This is research and paper-trading tooling. Short strangles have capped premium and uncapped risk on both sides, and FX gaps on central-bank surprises. In January 2015 the SNB unpeg moved EUR/CHF about 30% in minutes. Size accordingly, and model the tail before any money moves.

## Why FX spot first

On EUR/USD the all-in cost is roughly 0.5–1 pip, about 0.005–0.01% round trip. That's 30–60× cheaper than 0.3%. The first question is whether the fee was the whole problem:

```bash
npm run backtest -- --source yahoo --tf 1h
```

This prints the **same signals** scored gross, at the modeled FX spread, and at 0.3%. The `compareFeePct` setting in `config/default.json` controls the comparison levels.

## Setup

Requires Node 18 or later. There are no dependencies to install.

```bash
cd fx-desk
npm test
node src/cli.js            # help
```

### Data sources (`--source` or `config.data.source`)

| source | key needed | notes |
|---|---|---|
| `yahoo` (default) | no | Unofficial chart API. Covers 1h back about 730 days and 1d back about 10 years. 4h is resampled from 1h. Fine for research. |
| `oanda` | `OANDA_API_TOKEN` (free practice account) | Broker mid candles. Also returns the observed bid/ask spread, so you can replace `spreadPips` with measured values. |
| `csv` | no | `data/csv/<PAIR>_<tf>.csv` with `time,open,high,low,close[,volume]`. Finer files are resampled. |
| `synthetic` | no | Seeded random walk with vol regimes. **Checks the plumbing only and says nothing about edge.** |

Put local overrides in `config/local.json`. It is deep-merged over `default.json`.

## 1. Spot signals

```bash
node src/cli.js scan                 # run on a schedule (e.g. hourly cron, just after the close)
node src/cli.js score                # resolves any signal whose stop/target/timeout has happened
node src/cli.js report
```

- **Signal:** a Bollinger squeeze (width in the bottom `squeezePercentile` of the last `squeezeLookback` bars) for at least `minSqueezeBars` of the last `squeezeWindow` bars, then a close outside the prior `donchianPeriod` channel. Stop and target are `stopAtr` / `targetAtr` × ATR, with a `maxBars` timeout.
- **Scoring is conservative.** Entry is the *next bar's open*. If stop and target fall in the same bar, it counts as a stop. Cost is the spread plus slippage on both sides plus commission (`costs.js`). A `feePctRoundTrip` set on a pair overrides that.
- Signals the fundamentals filter blocks are **still logged and scored** with `blocked: true`. The report then shows whether the filter is earning its keep.
- A unit test checks the detector for lookahead: appending future bars must not change a past signal.

## 1b. Momentum (daily trend-following)

The 1h/4h/1d breakout tests showed no edge before costs. Time-series momentum is the better-documented FX effect, so it runs on the same data and cost model, scored as a daily return series.

```bash
node src/cli.js momentum backtest --source yahoo   # about 10y of daily data; in-sample vs out-of-sample
node src/cli.js momentum now                       # current target positions; logs a paper snapshot
node src/cli.js momentum paper                     # P&L of the logged snapshots
```

**The rule is fixed in `config.momentum` before any results are seen:**

- **Signal:** the average of sign(return) over the 63-, 126- and 252-day lookbacks, in the range -1 to +1.
- **Sizing:** signal × 10% ÷ 60-day realized vol, capped at ±3× equity per pair.
- **Rebalancing:** every 5 trading days. Trades happen one close after the signal (`executionLagDays`).
- **Cost:** half the round-trip spread for each unit the position changes. Gross, real spread and 0.3% are all shown.
- **Split:** in-sample before `outOfSampleStart` (2023-01-01), out-of-sample after. Make decisions on in-sample only. Look at out-of-sample once. If you change the rule after seeing it, it's no longer out-of-sample.
- **t-stat:** Sharpe × √years. |t| < 2 is indistinguishable from luck.

**Carry and interest.** Yahoo prices are spot, so the backtest **leaves out interest earned or paid on the position**. For a pair like USDJPY that's several percent a year. To include it, add `config/rates-history.csv` with columns `date,USD,EUR,GBP,JPY,CHF,AUD,CAD`. Use one row per rate change, and each row holds until the next. Only use rates you've checked against the central banks. With that file present, interest is accrued daily. Setting `carryWeight` (e.g. 0.5) also tilts the signal toward the higher-yielding side. `--no-carry` turns it all off.

## 1c. Range scan

Which pairs are ranging now, and how often have ranges actually broken? This also tests the idea of selling options outside historical highs and lows.

```bash
node src/cli.js range                          # ranks the majors plus AUDNZD, EURGBP, EURCHF, NZDUSD
node src/cli.js range --pair AUDNZD            # every horizon, all history vs the last 2 years
node src/cli.js range --days 120 --buffer-atr 1   # 120-day range, "strikes" 1 ATR outside it
```

**The current range** (last `--days` bars):
- **width:** in % and in ATRs.
- **position:** where the last close sits in the range.
- **efficiency ratio:** net move ÷ path. Near 0 is chop, 1 is a straight line.
- **variance ratio:** below 1 leans mean-reverting, above 1 leans trending.

**The breach study.** For every past day, take the prior N-day high/low (± buffer) and look H days ahead (5/10/20):
- **touched:** price traded through a level at some point. That's the intraperiod stress on a short option.
- **closed outside:** price was beyond a level on day H. That's a short option finishing in the money.
- **overshoot:** how far past the level it closed, as median, 95th percentile and max. That's the size of the losing weeks.

Days overlap, so the effective sample is far smaller than the day count. The pair lists and defaults are in `config.range`. Crosses can be scanned and traded spot, but `options` only maps the six USD pairs to CME futures.

## 2. Options analytics (CME FX futures options)

US retail can't trade OTC FX options. Strangles on currencies go through CME options on FX futures, which means a futures account (IBKR, tastytrade, NinjaTrader, …). Spot pairs map to futures as follows:

| spot | future | note |
|---|---|---|
| EURUSD, GBPUSD, AUDUSD | 6E, 6B, 6A | same direction |
| USDJPY, USDCAD, USDCHF | 6J, 6C, 6S | future = 1 / spot |

```bash
node src/cli.js options analyze --pair EURUSD --iv 7.4 --dte 30 --delta 0.16
node src/cli.js options log-iv --pair EURUSD --iv 7.4          # do this daily to build IV rank
node src/cli.js options paper-open --pair EURUSD --iv 7.4 --dte 30 --delta 0.16
node src/cli.js options score                                  # settles expired paper strangles
```

- **There is no free CME IV feed**, so pass `--iv` from your broker or CME CVOL. Without it, `analyze` uses 1.1 × RV20 as a clearly-labelled proxy, and `paper-open` refuses to log on that proxy.
- **Pricing** uses Black-76 on a carry-adjusted future estimate (covered interest parity from `config/rates.json`). Strikes are solved for delta and then snapped *outward* to the strike grid. Credit is net of `slippageTicksPerLeg` and fees.
- **Margin** is a 16-scenario SPAN-style estimate (price scan × vol up/down, plus extreme moves at 35%). It also shows the margin *after a bad day*, because SPAN expands with vol and the margin call arrives with the loss. Your broker's number is the real one.
- **Stress** covers ±1/2/3 × expected move, valued at expiry and immediately with an IV shock, plus gap scenarios (3%, 5%, Brexit-size, SNB-size) in both directions. It reports how many credits each row costs you.
- **Paper scoring** records P&L held to expiry *and* P&L with a stop at `stopLossMultipleOfCredit` × credit. It also records the worst mark-to-model drawdown. Daily marks use entry IV, so the stop check is approximate. Expiry P&L is exact given spot, apart from the futures/spot basis.

## 3. Fundamentals filter

```bash
node src/cli.js fundamentals update   # fetch ForexFactory weekly calendar + CFTC COT (no keys)
node src/cli.js fundamentals          # carry, COT pair index, next high-impact event per pair
node src/cli.js backtest --filter     # compare taken vs blocked
```

- **Calendar:** blocks new entries within `calendarBlackoutMinutes` of a High-impact event for either currency. Past weeks accumulate in `data/calendar.json`, so a filtered backtest only covers the period you've collected.
- **Carry:** the policy-rate differential from `config/rates.json`. **The shipped rates are placeholders.** Update them and set `asOf`, otherwise output is flagged `[stale]`. Optional `requireCarryAligned`.
- **COT:** net non-commercial positioning as a 3-year index (0–100), inverted for USD-base pairs. It tags trades that go *with* a crowded side. Optional `blockOnCrowded`.

## Files

```
config/default.json   strategy, spreads, options and filter settings
config/rates.json     policy rates (update these)
data/                 gitignored: signals.jsonl, outcomes.jsonl, strangles.jsonl,
                      strangle_outcomes.jsonl, iv/<future>.jsonl, cot/, calendar.json
src/signals/          breakout detector, scoring, walk-forward backtest, momentum
src/analysis/range.js range metrics and breach study
src/options/          black76, vol, strangle, margin, stress, paper
src/fundamentals/     rates, cot, calendar, filter
```

Set `FX_DESK_DATA_DIR` to keep journals somewhere else.
