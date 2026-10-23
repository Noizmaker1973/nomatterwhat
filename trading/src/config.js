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
const bases = (env.SYMBOLS || 'BTC,ETH,SOL,BNB')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

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
  candleLimit: 300,

  // Live trading needs two explicit opt-ins so nobody trades real money by accident.
  mode: requestedMode === 'live' && liveConfirmed ? 'live' : 'paper',
  liveRequestedButUnconfirmed: requestedMode === 'live' && !liveConfirmed,
  paperStartingBalance: num(env.PAPER_STARTING_BALANCE, 10000),
  autoTrade: bool(env.AUTO_TRADE, false),
  enforceStops: bool(env.ENFORCE_STOPS, true),
  dataSource: (env.DATA_SOURCE || 'exchange').toLowerCase(),

  risk: {
    riskPerTradePct: num(env.RISK_PER_TRADE_PCT, 1),
    maxPositionPct: num(env.MAX_POSITION_PCT, 25),
    dailyLossLimitPct: num(env.DAILY_LOSS_LIMIT_PCT, 5),
    minOrderSize: num(env.MIN_ORDER_SIZE, 10),
  },

  strategy: {
    buyThreshold: num(env.BUY_THRESHOLD, 3),
    sellThreshold: num(env.SELL_THRESHOLD, -3),
  },

  port: num(env.PORT, 4000),
  host: env.HOST || '127.0.0.1',
  scanIntervalSec: Math.max(10, num(env.SCAN_INTERVAL_SEC, 60)),
  dashboardToken: env.DASHBOARD_TOKEN || '',

  notify: {
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || '',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: env.TELEGRAM_CHAT_ID || '',
  },

  dataDir: path.join(__dirname, '..', 'data'),
};

module.exports = config;
