// HTTP API + dashboard.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const { createMarketData } = require('./marketData');
const { PaperBroker } = require('./brokers/paperBroker');
const { LiveBroker } = require('./brokers/liveBroker');
const { createNotifier } = require('./notifier');
const { TradingEngine } = require('./engine');

function createBroker() {
  return config.mode === 'live' ? new LiveBroker(config) : new PaperBroker(config);
}

function requireToken(req, res, next) {
  if (!config.dashboardToken) return next();
  const given = Buffer.from(String(req.get('x-dashboard-token') || ''));
  const expected = Buffer.from(config.dashboardToken);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
  return res.status(401).json({ error: 'Invalid or missing dashboard token' });
}

function createApp(engine) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => res.status(400).json({ error: err.message }));

  app.get('/api/status', (req, res) => {
    res.json({
      mode: engine.broker.mode,
      liveRequestedButUnconfirmed: config.liveRequestedButUnconfirmed,
      exchange: config.exchange,
      dataSource: engine.marketData.name,
      timeframe: config.timeframe,
      symbols: config.symbols,
      quote: config.quote,
      autoTrade: engine.autoTrade,
      enforceStops: config.enforceStops,
      risk: config.risk,
      strategy: config.strategy,
      guard: engine.guardState,
      lastScanAt: engine.lastScanAt,
      scanIntervalSec: config.scanIntervalSec,
      errors: engine.errors,
      tokenRequired: Boolean(config.dashboardToken),
      notifications: engine.notifier.enabled,
    });
  });

  app.get('/api/signals', (req, res) => res.json(config.symbols.map((s) => engine.signals[s] || { symbol: s, signal: 'LOADING' })));
  app.get('/api/portfolio', wrap(async (req, res) => res.json(await engine.getPortfolio())));
  app.get('/api/trades', (req, res) => res.json(engine.trades));
  app.get('/api/alerts', (req, res) => res.json(engine.alerts));
  app.get('/api/candles', (req, res) => {
    const candles = engine.candles[req.query.symbol];
    if (!candles) return res.status(404).json({ error: 'No candles for that symbol yet' });
    res.json(candles.slice(-Number(req.query.limit || 150)));
  });

  app.post('/api/scan', requireToken, wrap(async (req, res) => {
    await engine.scan();
    res.json({ ok: true, lastScanAt: engine.lastScanAt });
  }));

  app.post('/api/order', requireToken, wrap(async (req, res) => {
    const { symbol, side, quoteAmount, percent } = req.body || {};
    const trade = await engine.placeOrder({ symbol, side, quoteAmount, percent, source: 'manual', reason: 'Dashboard order' });
    res.json(trade);
  }));

  app.post('/api/stops', requireToken, wrap(async (req, res) => {
    const { symbol, stopLoss, takeProfit } = req.body || {};
    res.json(engine.setStops(symbol, { stopLoss, takeProfit }));
  }));

  app.post('/api/auto-trade', requireToken, (req, res) => {
    engine.setAutoTrade(req.body?.enabled);
    res.json({ autoTrade: engine.autoTrade });
  });

  app.post('/api/paper/reset', requireToken, wrap(async (req, res) => {
    if (engine.broker.mode !== 'paper') throw new Error('Only available in paper mode');
    await engine.broker.reset(config.paperStartingBalance);
    engine.clearHistory();
    engine.addAlert('info', `Paper account reset to ${config.paperStartingBalance} ${config.quote}`);
    res.json({ ok: true });
  }));

  return app;
}

async function main() {
  const broker = createBroker();
  await broker.init();
  const engine = new TradingEngine(config, {
    marketData: createMarketData(config),
    broker,
    notifier: createNotifier(config.notify),
  });

  if (config.liveRequestedButUnconfirmed) {
    engine.addAlert('info', 'TRADING_MODE=live ignored: set CONFIRM_LIVE_TRADING=yes to trade real money. Running in PAPER mode.');
  }
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.dashboardToken) {
    console.warn('WARNING: dashboard is exposed on the network without DASHBOARD_TOKEN. Anyone who can reach it can place orders.');
  }

  createApp(engine).listen(config.port, config.host, () => {
    console.log(`Crypto Signal Trader running at http://${config.host}:${config.port}`);
    console.log(`Mode: ${broker.mode.toUpperCase()} | Exchange: ${config.exchange} | Data: ${engine.marketData.name} | Auto-trade: ${engine.autoTrade}`);
  });
  engine.start();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createApp };
