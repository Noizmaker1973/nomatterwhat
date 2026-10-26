const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env;

const num = (value, fallback) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const quote = (env.QUOTE_CURRENCY || 'USDT').toUpperCase();
const list = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
const bases = list(env.SYMBOLS || 'BTC,ETH,SOL,BNB');
// Day-trading coins (run `npm run screen` to pick them). A coin can only be in one group.
const dayBases = list(env.DAY_SYMBOLS).filter((b) => !bases.includes(b));
const modeOf = (value, fallback) => (['classic', 'trend', 'ma'].includes((value || '').toLowerCase()) ? value.toLowerCase() : fallback);

const requestedMode = (env.TRADING_MODE || 'paper').toLowerCase();
const liveConfirmed = (env.CONFIRM_LIVE_TRADING || '').toLowerCase() === 'yes';

const config = {
  exchange: (env.EXCHANGE || 'binanceus').toLowerCase(),
  apiKey: env.EXCHANGE_API_KEY || '',
  apiSecret: env.EXCHANGE_API_SECRET || '',
  apiPassword: env.EXCHANGE_API_PASSWORD || '',
  quote,
  symbols: bases.map((b) => `${b}/${quote}`),
  timeframe: env.TIMEFRAME || '1h',
  candleLimit: 500, // enough for a 200-candle average plus ~300 candles of signal history on the chart

  // Live trading needs two explicit opt-ins so nobody trades real money by accident.
  mode: requestedMode === 'live' && liveConfirmed ? 'live' : 'paper',
  liveRequestedButUnconfirmed: requestedMode === 'live' && !liveConfirmed,
  paperStartingBalance: num(env.PAPER_STARTING_BALANCE, 10000),
  autoTrade: bool(env.AUTO_TRADE, false),
  enforceStops: bool(env.ENFORCE_STOPS, true),
  // `--demo` on the command line works on every OS (Windows has no `VAR=x cmd`).
  dataSource: process.argv.includes('--demo') ? 'demo' : (env.DATA_SOURCE || 'exchange').toLowerCase(),

  risk: {
    riskPerTradePct: num(env.RISK_PER_TRADE_PCT, 1),
    maxPositionPct: num(env.MAX_POSITION_PCT, 25),
    dailyLossLimitPct: num(env.DAILY_LOSS_LIMIT_PCT, 5),
    minOrderSize: num(env.MIN_ORDER_SIZE, 10),
  },

  strategy: {
    mode: modeOf(env.STRATEGY_MODE, 'classic'),
    buyThreshold: num(env.BUY_THRESHOLD, 3),
    sellThreshold: num(env.SELL_THRESHOLD, -3),
    stopAtrMult: num(env.STOP_ATR_MULT, 2),
    targetAtrMult: num(env.TARGET_ATR_MULT, 3),
    trailAtrMult: num(env.TRAIL_ATR_MULT, 3),
    maPeriod: Math.round(num(env.MA_PERIOD, 200)),
  },

  port: num(env.PORT, 4000),
  host: env.HOST || '127.0.0.1',
  scanIntervalSec: Math.max(10, num(env.SCAN_INTERVAL_SEC, 60)),
  // Only used when the exchange's WebSocket price stream is unavailable.
  pricePollSec: Math.max(1, num(env.PRICE_POLL_SEC, 2)),
  dashboardToken: env.DASHBOARD_TOKEN || '',

  notify: {
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
  },

  dataDir: path.join(__dirname, '..', 'data'),
};

// Coins are traded in groups, each with its own timeframe, strategy and limits:
//   main - the coins in SYMBOLS, using the settings above
//   day  - optional day-trading coins in DAY_SYMBOLS, using the DAY_* settings
const mainGroup = {
  name: 'main',
  label: 'Swing',
  symbols: config.symbols,
  timeframe: config.timeframe,
  strategy: config.strategy,
  risk: config.risk,
  autoTrade: true, // follows the dashboard's Auto-trade switch
};
// The day settings exist even with no DAY_SYMBOLS, so candidate coins can be
// backtested and optimized with them before being added.
const daySettings = {
      name: 'day',
      label: 'Day',
      symbols: dayBases.map((b) => `${b}/${quote}`),
      timeframe: env.DAY_TIMEFRAME || '15m',
      strategy: {
        mode: modeOf(env.DAY_STRATEGY_MODE, 'trend'),
        buyThreshold: num(env.DAY_BUY_THRESHOLD, 4),
        sellThreshold: num(env.DAY_SELL_THRESHOLD, -3),
        stopAtrMult: num(env.DAY_STOP_ATR_MULT, 1.5),
        targetAtrMult: num(env.DAY_TARGET_ATR_MULT, 2),
        trailAtrMult: num(env.DAY_TRAIL_ATR_MULT, 3),
        maPeriod: Math.round(num(env.DAY_MA_PERIOD, 50)),
      },
      risk: { ...config.risk, maxPositionPct: num(env.DAY_MAX_POSITION_PCT, 10) },
      // Day coins only auto-trade if this is on AND the dashboard switch is on.
      autoTrade: bool(env.DAY_AUTO_TRADE, false),
};

config.groups = daySettings.symbols.length ? [mainGroup, daySettings] : [mainGroup];
config.symbols = config.groups.flatMap((g) => g.symbols);
config.settingsFor = (symbol) => config.groups.find((g) => g.symbols.includes(symbol)) || mainGroup;
config.groupNamed = (name) => ({ main: mainGroup, day: daySettings })[name];

// Which group a backtest/optimizer run uses: --group, or the group of the
// coins listed, or the main group. Returns the group and the coins to test.
config.resolveGroup = (bases, groupName) => {
  if (groupName && !config.groupNamed(groupName)) throw new Error(`Unknown group "${groupName}" (use main or day)`);
  const listed = bases.map((b) => `${b}/${quote}`);
  let group = groupName ? config.groupNamed(groupName) : mainGroup;
  if (!groupName && listed.length) {
    const groups = [...new Set(listed.map((s) => config.settingsFor(s).name))];
    if (groups.length > 1) throw new Error('Those coins are in different groups; test one group at a time (or add --group main/day)');
    group = config.groupNamed(groups[0]);
  }
  const symbols = listed.length ? listed : group.symbols;
  if (!symbols.length) throw new Error('The day group has no coins yet: list some (e.g. DOGE AVAX LINK) or set DAY_SYMBOLS (see npm run screen)');
  return { group, symbols };
};

module.exports = config;
