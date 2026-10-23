# Crypto Signal Trader

A self-hosted platform that watches **BTC, ETH, SOL and BNB**, generates **buy/sell signals from technical analysis**, and connects to your exchange so you can trade with one click from a dashboard, or let it trade automatically.

> **Risk warning:** Signals come from technical indicators. They are not financial advice and will often be wrong. Crypto is extremely volatile. Start in **paper mode**, run the **backtester**, and only trade money you can afford to lose.

## What it does

| Feature | Details |
|---|---|
| **Signals** | Scores RSI, MACD, EMA 9/21/50/200, Bollinger Bands and volume into one BUY / SELL / HOLD signal with a confidence level and the reasons behind it |
| **Stops & targets** | Every signal includes an ATR-based stop-loss (2×ATR) and take-profit (3×ATR) |
| **Exchange connection** | Uses [CCXT](https://github.com/ccxt/ccxt), which supports 100+ exchanges: Binance.US, Binance, Kraken, Coinbase, OKX, Bybit, KuCoin and more |
| **One-click trading** | Dashboard Buy/Sell buttons. Leave the amount empty and the platform sizes the trade from your risk settings |
| **Auto-trading** | Optional. Buys on BUY signals, sells on SELL signals, and enforces stop-loss/take-profit |
| **Paper trading** | Simulated account against real prices (with fees and slippage). This is the default |
| **Risk management** | Risk-per-trade sizing, max position size per coin, daily loss limit that pauses new buys |
| **Backtester** | Replays the strategy on historical candles and compares it to buy-and-hold |
| **Alerts** | Optional Discord and/or Telegram notifications for signals and trades |

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

Each indicator votes, and the votes are summed into a score:

| Indicator | Bullish | Bearish |
|---|---|---|
| Trend: price and EMA50 vs EMA200 | +1 | −1 |
| EMA 9/21 crossover (last 3 candles) | +2 (above: +0.5) | −2 (below: −0.5) |
| MACD histogram crossover | +1.5 (rising: +0.5) | −1.5 (falling: −0.5) |
| RSI(14) | +2 recovering from <30, +1.5 when <30 | −2 falling from >70, −1.5 when >70 |
| Bollinger Bands (20, 2) | +1 below lower band | −1 above upper band |
| Volume > 1.5× its 20-bar average | score ×1.25 | score ×1.25 |

**score ≥ BUY_THRESHOLD (3) → BUY, score ≤ SELL_THRESHOLD (−3) → SELL**, anything in between is HOLD. Signals use **closed candles only**, so they don't flicker while a candle is still forming. Raise the thresholds for fewer, stronger signals.

This is **spot trading only**: SELL means "sell what you hold". It never shorts or uses leverage.

## Risk settings

| Setting | Default | Meaning |
|---|---|---|
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
| POST | `/api/order` | `{ "symbol": "BTC/USDT", "side": "buy", "quoteAmount": 250 }` (omit `quoteAmount` for auto size) or `{ "symbol": "BTC/USDT", "side": "sell", "percent": 50 }` |
| POST | `/api/stops` | `{ "symbol", "stopLoss", "takeProfit" }` |
| POST | `/api/auto-trade` | `{ "enabled": true }` |
| POST | `/api/scan` | run a scan now |
| POST | `/api/paper/reset` | reset the paper account |

POST routes require the `x-dashboard-token` header when `DASHBOARD_TOKEN` is set.
