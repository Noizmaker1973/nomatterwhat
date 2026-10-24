# Crypto Signal Trader

A self-hosted platform that watches **BTC, ETH, SOL and BNB**, generates **buy/sell signals from technical analysis**, and connects to your exchange so you can trade with one click from a dashboard, or let it trade automatically.

> **Risk warning:** Signals come from technical indicators. They are not financial advice and will often be wrong. Crypto is extremely volatile. Start in **paper mode**, run the **backtester**, and only trade money you can afford to lose.

## What it does

| Feature | Details |
|---|---|
| **Signals** | Scores RSI, MACD, EMA 9/21/50/200, Bollinger Bands and volume into one BUY / SELL / HOLD signal with a confidence level and the reasons behind it |
| **Stops & targets** | Every signal includes an ATR-based stop-loss (2×ATR) and take-profit (3×ATR) |
| **Exchange connection** | Uses [CCXT](https://github.com/ccxt/ccxt), which supports 100+ exchanges: Binance.US, Binance, Kraken, Coinbase, OKX, Bybit, KuCoin and more |
| **Suggested trades** | Each coin shows what to do right now (buy how much, sell, keep holding or wait), with the stop-loss, target, max loss, potential gain and reward:risk. One click places it |
| **Live updates** | Prices stream over the exchange's WebSocket feed (falling back to polling every 2s) and are pushed to the dashboard instantly. Stops trigger on the live price, and signals are recalculated the moment a candle closes |
| **One-click trading** | Dashboard Buy/Sell buttons. Leave the amount empty and the platform sizes the trade from your risk settings |
| **Auto-trading** | Optional. Buys on BUY signals, sells on SELL signals, and enforces stop-loss/take-profit |
| **Paper trading** | Simulated account against real prices (with fees and slippage). This is the default |
| **Risk management** | Risk-per-trade sizing, max position size per coin, daily loss limit that pauses new buys |
| **Live chart** | Candlesticks with the strategy's lines, ▲/▼ arrows where BUY and SELL signals fired, dots for your trades, and dashed entry/stop/target lines. Ticks with the live price. Click a coin's small chart to open it |
| **Shorting (paper)** | Optional: short on SELL signals, cover on BUY. Backtested with fees, slippage and borrowing cost. Paper trading only: Binance.US cannot short |
| **Options ideas** | Each signal comes with a limited-risk options trade and its estimated premium, breakeven, max loss and odds. Estimates only, no options orders |
| **Backtester** | Replays the strategy on historical candles and compares it to buy-and-hold |
| **Alerts** | A signal alert fires only when a coin's signal changes (e.g. HOLD → SELL), not on every candle that repeats it. Optional Discord and/or Telegram notifications for signals and trades |

## Quick start

```bash
cd trading
npm install
cp .env.example .env

npm run demo        # offline demo with synthetic prices -> http://localhost:4000
npm start           # real market data, paper trading   -> http://localhost:4000
```

Other commands:

```bash
npm run signals                          # print current signals in the terminal
npm run backtest                         # backtest all coins (2000 bars of TIMEFRAME)
npm run backtest -- BTC SOL --bars 3000 --timeframe 4h
npm run backtest -- --demo               # any command accepts --demo for synthetic prices
npm run optimize                         # find settings that held up on unseen history
npm run configure -- TIMEFRAME=1d MA_PERIOD=50   # change .env settings (keeps everything else)
npm run configure                        # show the current strategy settings
npm test                                 # unit tests
```

## Connecting your exchange (live trading)

1. **Pick an exchange** that lists all four coins and set `EXCHANGE` in `.env`:
   - US: `binanceus` (quote `USDT` or `USD`)
   - Outside the US: `binance`, `okx`, `bybit`, `kucoin` ...
   - Coinbase and Kraken work for BTC/ETH/SOL, but check that they list BNB in your region.
2. **Create an API key** on the exchange with **trading permission only**. **Never enable withdrawals.** Restrict the key to your IP address if the exchange allows it.
3. Add it to `.env`:
   ```
   EXCHANGE_API_KEY=...
   EXCHANGE_API_SECRET=...
   ```
4. Turn on live mode. This takes **two** settings so it can't happen by accident:
   ```
   TRADING_MODE=live
   CONFIRM_LIVE_TRADING=yes
   ```
5. Restart (`npm start`). The dashboard shows a red **LIVE TRADING** badge, and every order asks for confirmation.

When starting live, the platform checks that your exchange lists every symbol in `SYMBOLS` and refuses to start if one is missing.

## How signals are scored

There are two strategy modes, chosen with `STRATEGY_MODE` in `.env`:

| | `classic` (default) | `trend` | `ma` (moving average) |
|---|---|---|---|
| Idea | Mixes trend-following with buying dips / selling rallies | Ride uptrends, stay out of downtrends | Hold while the price is above its long-term average, cash while below |
| When it buys | Score reaches BUY_THRESHOLD | Score reaches BUY_THRESHOLD **and** price and EMA50 are above EMA200 | Price is BUY_THRESHOLD % or more above its MA_PERIOD-candle average |
| "Overbought" RSI / price above upper Bollinger Band | Counts against buying | Treated as strength | Ignored |
| Exit | Stop-loss, fixed take-profit (TARGET_ATR_MULT × ATR), or SELL signal | **Trailing stop** that follows the highest price up by TRAIL_ATR_MULT × ATR and never moves down, or SELL signal | Price closes SELL_THRESHOLD % or more below the average. **No stop-loss** |
| Trades | Many | Fewer | Very few |

Classic mode tends to lose in strong one-way markets, because it keeps taking small profits and selling strength. Trend mode tends to lose in choppy sideways markets, getting stopped out repeatedly. Moving-average mode trails buy and hold in a straight bull run and gives back part of each drop before it exits; its value is avoiding most of a long bear market. Run the optimizer to see which suited your exchange's history.

### Moving-average mode

With `TIMEFRAME=1d` and `MA_PERIOD=200` this is the classic **200-day rule**. On other timeframes the period is in candles, so `MA_PERIOD=200` on `4h` is about a 33-day average.

The score on each coin card is the **% distance from the average** (e.g. `+4.2` = 4.2% above), and `BUY_THRESHOLD` / `SELL_THRESHOLD` are a buffer around the line. With `2` and `-2`, it buys at 2% above the average and sells at 2% below, so small wiggles around the line don't cause a trade every day. Positions have **no stop-loss**: each buy is sized at the max position cap (`MAX_POSITION_PCT`), and the exit is the close below the average. A sudden crash can therefore cost more than in the other modes before the exit triggers.

### Classic mode scoring

Each indicator votes, and the votes are summed into a score:

| Indicator | Bullish | Bearish |
|---|---|---|
| Trend: price and EMA50 vs EMA200 | +1 | −1 |
| EMA 9/21 crossover (last 3 candles) | +2 (above: +0.5) | −2 (below: −0.5) |
| MACD histogram crossover | +1.5 (rising: +0.5) | −1.5 (falling: −0.5) |
| RSI(14) | +2 recovering from <30, +1.5 when <30 | −2 falling from >70, −1.5 when >70 |
| Bollinger Bands (20, 2) | +1 below lower band | −1 above upper band |
| Volume > 1.5× its 20-bar average | score ×1.25 | score ×1.25 |

**score ≥ BUY_THRESHOLD (3) → BUY, score ≤ SELL_THRESHOLD (−3) → SELL**, anything in between is HOLD. Each coin card shows this as a gauge: the red zone is SELL, the green zone is BUY, the lines are the trigger levels, and the dot is the current score. A hollow ring on the gauge shows the **live** score, which includes the still-forming candle, so you can watch a signal building. Signals use **closed candles only**, so they don't flicker while a candle is still forming. Raise the thresholds for fewer, stronger signals.

### Trend mode scoring

| Indicator | Bullish | Bearish |
|---|---|---|
| Trend: price and EMA50 vs EMA200 | +2 | −2 |
| EMA 9/21 crossover (last 3 candles) | +2 (above: +0.5) | −2 (below: −0.5) |
| MACD histogram crossover | +1.5 (rising: +0.5) | −1.5 (falling: −0.5) |
| RSI(14) | +1.5 pullback over (back above 40 in an uptrend), +0.5 when ≥ 50 | −0.5 when < 50 |
| Breakout above upper Bollinger Band in an uptrend | +0.5 | |
| Close drops below EMA50 | | −1 (and SELL if not in an uptrend) |
| Volume > 1.5× its 20-bar average | score ×1.25 | score ×1.25 |

This is **spot trading only**: SELL means "sell what you hold". It never shorts or uses leverage.

## Finding good settings: the optimizer

```bash
npm run optimize                                   # 1h and 4h candles, 3000 bars each
npm run optimize -- --timeframes "4h,1d" --bars 2500
npm run optimize -- BTC ETH --bars 4000 --timeframes "1h,4h,1d"
```

In **PowerShell, keep the timeframe list in quotes**. Without them PowerShell reads `1d` as the number 1.

It tries 352 combinations per timeframe on your exchange's real history: 144 classic and 144 trend (buy/sell thresholds × stop size × target or trail size), plus 64 moving-average (period 50/100/150/200 × buy and sell buffers). To avoid settings that only fit the past:

1. Each coin trades **its share of one account** (a quarter each with four coins), with your risk settings applied to the whole account, exactly as on the platform.
2. History is split: the **first two-thirds** (train) and the **last third** (test).
3. Every combination is ranked on **train only**.
4. The top 5 are then run on **test**, data they were never chosen on. **The TEST columns are the honest result.** The best setting of any mode that missed the top 5 is listed too, marked `best`.
5. Combinations with fewer than 3 trades per coin on train are ignored as luck.

It prints your current settings next to the best ones, then the `.env` lines for the overall pick. If even the best setting lost money or had a profit factor below 1 on the test data, it says so and tells you not to trade it.

**Reading the results:** `expo%` is how much of the account was invested on average. With the default risk settings (1% risk per trade, max 25% per coin, four coins) the stop-based modes are usually well under half invested, while buy and hold is always 100% invested. So a strategy can be good and still return far less than buy and hold in a rising market. It wins by being out of the market during drops. Compare drawdowns, not only returns.

## Shorting

With `ALLOW_SHORT=true`, a **SELL signal sells any coins you hold and then opens a short**, which profits if the price keeps falling. A **BUY signal covers (buys back) the short and then buys**. In trend mode a short is only opened in a downtrend (price and EMA50 below EMA200), mirroring "only buy in an uptrend".

How shorts are handled:

- **Risk:** a short's stop sits *above* the entry. Trailing stops follow the lowest price *down*. In moving-average mode there is no stop: the short is covered when the price closes back above the buy level. A short's loss has no natural limit if the price keeps rising, so the stop matters.
- **Costs:** fees and slippage as for buying, plus a **borrowing cost** (`SHORT_COST_APR`, default 10% a year) charged for as long as the short is open. Real margin interest or futures funding varies a lot and can be much higher in strong bull markets.
- **Paper account:** opening a short sets aside its value as collateral, so that cash can't also be used for buying.
- **Live trading:** **not supported.** Binance.US spot accounts can't borrow to short, so the platform refuses to short in live mode and says so at startup.

**Does shorting help?** The optimizer answers that on your exchange's history: every setting is tested long-only and with shorting (`+S`), and the best of each is listed side by side. Crypto has risen over most long periods, so shorts often lose money on balance, even with a decent signal. Trust the TEST columns, not intuition.

**If you want to short with real money in the US**, the legal routes are regulated ones, for example futures on a CFTC-regulated venue such as Coinbase Derivatives or CME (through a futures broker), or put options on spot bitcoin/ether ETFs through a stock broker. Check what is available to you today. Offshore exchanges that offer crypto shorting generally prohibit US residents, and using a VPN to get around that breaks their terms and can get your account and funds frozen. The platform can't connect to any of these yet.

## Options ideas

Each coin card has an **Options idea (estimate)** panel that matches the signal with a **limited-risk** options trade:

| Signal | Idea | What it means |
|---|---|---|
| BUY, coin not held | **Cash-secured put** | Sell a put below the price and keep cash aside. You collect a premium; if the price falls below the strike, you buy the coin there |
| BUY or HOLD, coin held | **Covered call** | Sell a call above the price against coins you hold. You collect a premium but give up gains above the strike |
| SELL | **Bear call spread** | Sell a call above the price and buy a further one higher. You collect a credit; the most you can lose is the gap between strikes minus the credit |

Prices are **estimates**: Black-Scholes with the coin's recent realized volatility, 30-day expiry, strikes about half a standard deviation from the price. Real option prices use implied volatility, which is usually higher (so premiums are usually larger), and they move quickly. The platform never suggests selling naked calls or puts without collateral, because their losses are open-ended.

**Options can't be backtested here** (there's no historical option price data) and **can't be traded through the platform**: Binance.US has no options. In the US, listed crypto options are mainly options on spot bitcoin/ether ETFs (at a stock broker, priced in ETF shares rather than coins) and CME options on bitcoin/ether futures. There are few or no US-available options for SOL or BNB. Check real quotes before acting on any idea.

## Strategy and risk settings

| Setting | Default | Meaning |
|---|---|---|
| `STRATEGY_MODE` | classic | `classic`, `trend` or `ma` (see above) |
| `STOP_ATR_MULT` | 2 | Initial stop-loss distance below entry, in ATRs |
| `TARGET_ATR_MULT` | 3 | Classic: take-profit distance above entry, in ATRs |
| `TRAIL_ATR_MULT` | 3 | Trend: trailing-stop distance below the highest price, in ATRs |
| `MA_PERIOD` | 200 | Moving average: length of the average, in candles |
| `ALLOW_SHORT` | false | Short on SELL signals, cover on BUY (paper trading and backtests only) |
| `SHORT_COST_APR` | 10 | Yearly cost of borrowing to short, in % |
| `RISK_PER_TRADE_PCT` | 1 | If the stop-loss is hit you lose about this % of equity. Position size = risk ÷ stop distance |
| `MAX_POSITION_PCT` | 25 | Never put more than this % of equity in one coin |
| `DAILY_LOSS_LIMIT_PCT` | 5 | Once equity is this % down for the day (UTC), new buys stop until tomorrow |
| `MIN_ORDER_SIZE` | 10 | Smallest order in quote currency |
| `ENFORCE_STOPS` | true | Sell automatically at the stop-loss / take-profit, even when auto-trade is off |

You can change any position's stop-loss or take-profit by clicking it in the Portfolio table.

## Dashboard security

The server listens on `127.0.0.1` (your machine only) by default. If you expose it (`HOST=0.0.0.0`, a VPS, etc.), **set `DASHBOARD_TOKEN`**. Otherwise anyone who can reach the page can place orders. Put it behind HTTPS (a reverse proxy) as well.

## Notifications

Set `DISCORD_WEBHOOK_URL` and/or `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to get new signals, trades, stop-loss hits and errors on your phone.

## Project layout

```
trading/
├── src/
│   ├── server.js          # Express API + dashboard host + startup
│   ├── engine.js          # scan loop, signals, stops, auto-trade, order handling
│   ├── strategy.js        # indicator scoring -> BUY/SELL/HOLD
│   ├── indicators.js      # SMA, EMA, RSI, MACD, Bollinger, ATR
│   ├── risk.js            # position sizing, daily loss guard
│   ├── marketData.js      # CCXT market data + offline demo feed
│   ├── brokers/
│   │   ├── paperBroker.js # simulated fills (0.1% fee, 0.05% slippage)
│   │   └── liveBroker.js  # real orders via CCXT
│   ├── backtest.js        # historical simulation (CLI)
│   ├── optimize.js        # train/test settings search (CLI)
│   ├── options.js         # Black-Scholes options ideas (estimates)
│   ├── configure.js       # update .env settings safely (CLI)
│   ├── cli.js             # terminal signal check
│   └── notifier.js        # Discord / Telegram
├── public/                # dashboard (HTML/CSS/JS, no build step)
├── test/                  # node:test unit tests
└── data/                  # paper account, positions, trade log (git-ignored)
```

## API

| Method | Path | Body |
|---|---|---|
| GET | `/api/status` | mode, exchange, risk settings, loss-guard state |
| GET | `/api/signals` | latest signal per coin |
| GET | `/api/portfolio` | cash, equity, positions with P&L |
| GET | `/api/trades` · `/api/alerts` | history |
| GET | `/api/candles?symbol=BTC/USDT` | recent candles |
| GET | `/api/chart?symbol=BTC/USDT` | candles, strategy lines, signal changes, trades and open position for the chart |
| GET | `/api/snapshot` | signals with suggested trades, portfolio and status in one call |
| GET | `/api/stream` | Server-Sent Events: live `snapshot`, `alert` and `trade` events |
| POST | `/api/order` | `{ "symbol": "BTC/USDT", "side": "buy", "quoteAmount": 250 }` (omit `quoteAmount` for auto size) or `{ "symbol": "BTC/USDT", "side": "sell", "percent": 50 }`; shorting uses `"side": "short"` (with `quoteAmount`) and `"side": "cover"` (with `percent`) |
| POST | `/api/stops` | `{ "symbol", "stopLoss", "takeProfit" }` |
| POST | `/api/auto-trade` | `{ "enabled": true }` |
| POST | `/api/scan` | run a scan now |
| POST | `/api/paper/reset` | reset the paper account |

POST routes require the `x-dashboard-token` header when `DASHBOARD_TOKEN` is set.
