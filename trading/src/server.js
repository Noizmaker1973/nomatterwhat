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
  // no-cache: the browser re-checks the dashboard files on every load, so an
  // update is picked up by a normal refresh instead of running stale code.
  app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => res.status(400).json({ error: err.message }));

  const status = () => ({
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
    priceFeed: engine.priceFeed,
    groups: config.groups.map((g) => ({
      name: g.name,
      label: g.label,
      symbols: g.symbols,
      timeframe: g.timeframe,
      mode: g.strategy.mode,
      autoTrade: g.autoTrade,
      maxPositionPct: g.risk.maxPositionPct,
    })),
  });

  app.get('/api/status', (req, res) => res.json(status()));

  app.get('/api/signals', (req, res) => res.json(engine.snapshot().signals));
  app.get('/api/snapshot', (req, res) => res.json({ ...engine.snapshot(), status: status() }));

  // Server-Sent Events: pushes a fresh snapshot to the dashboard on every
  // price update (at most a few times per second), and alerts/trades as
  // they happen.
  app.get('/api/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    let pending = null;
    const pushSnapshot = () => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        send('snapshot', { ...engine.snapshot(), status: status() });
      }, 250);
    };
    const onAlert = (alert) => send('alert', alert);
    const onTrade = (trade) => send('trade', trade);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);

    send('snapshot', { ...engine.snapshot(), status: status() });
    engine.on('tick', pushSnapshot);
    engine.on('scan', pushSnapshot);
    engine.on('alert', onAlert);
    engine.on('trade', onTrade);
    req.on('close', () => {
      clearTimeout(pending);
      clearInterval(heartbeat);
      engine.off('tick', pushSnapshot);
      engine.off('scan', pushSnapshot);
      engine.off('alert', onAlert);
      engine.off('trade', onTrade);
    });
  });
  app.get('/api/portfolio', wrap(async (req, res) => res.json(await engine.getPortfolio())));
  app.get('/api/trades', (req, res) => res.json(engine.trades));
  app.get('/api/alerts', (req, res) => res.json(engine.alerts));
  app.get('/api/chart', (req, res) => {
    const data = engine.chartData(req.query.symbol);
    if (!data) return res.status(404).json({ error: 'No chart data for that symbol yet' });
    res.json(data);
  });
  app.get('/vendor/lightweight-charts.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    // The package's exports map hides this file, so find it next to the main entry.
    res.sendFile(path.join(path.dirname(require.resolve('lightweight-charts')), 'dist', 'lightweight-charts.standalone.production.js'));
  });

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
  engine.setMaxListeners(200); // one set of listeners per open dashboard tab

  if (config.liveRequestedButUnconfirmed) {
    engine.addAlert('info', 'TRADING_MODE=live ignored: set CONFIRM_LIVE_TRADING=yes to trade real money. Running in PAPER mode.');
  }
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && !config.dashboardToken) {
    console.warn('WARNING: dashboard is exposed on the network without DASHBOARD_TOKEN. Anyone who can reach it can place orders.');
  }

  const server = createApp(engine).listen(config.port, config.host, () => {
    console.log(`Crypto Signal Trader running at http://${config.host}:${config.port}`);
    console.log(`Mode: ${broker.mode.toUpperCase()} | Exchange: ${config.exchange} | Data: ${engine.marketData.name} | Auto-trade: ${engine.autoTrade}`);
    // Only trade once we own the port: a second copy must never trade the same account.
    engine.start();
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} is already in use: the platform is probably already running in another window.`);
      console.error('Stop that one first (Ctrl+C in its window), or open http://localhost:' + config.port + ' to use it.');
      process.exit(2); // start-trader.cmd uses this to avoid a restart loop
    }
    console.error(`Server error: ${err.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { createApp };
