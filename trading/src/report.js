// Paper-trading report: how the signals have done so far.
//
//   npm run report
//
// Reads the paper account, positions and trade log from data/, values open
// positions at current prices, and prints a summary per coin. Safe to run
// while the platform is running (it only reads).

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createMarketData } = require('./marketData');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.dataDir, file), 'utf8'));
  } catch {
    return fallback;
  }
};

const usd = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n) => `${n >= 0 ? '+' : ''}${usd(n)}`;
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const day = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

// Pure summary so it can be tested without files or network.
function summarize({ account, positions, trades, prices, startingBalance, quote }) {
  const coins = new Set([...Object.keys(account.holdings || {}), ...trades.map((t) => t.symbol.split('/')[0])]);
  const rows = [...coins].map((base) => {
    const symbol = `${base}/${quote}`;
    const mine = trades.filter((t) => t.symbol === symbol);
    const sells = mine.filter((t) => t.side === 'sell');
    const buys = mine.filter((t) => t.side === 'buy');
    const amount = account.holdings?.[base] || 0;
    const price = prices[symbol] ?? null;
    const entry = positions[symbol]?.entryPrice ?? null;
    const realized = sells.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);
    const unrealized = amount > 0 && price && entry ? (price - entry) * amount : 0;
    const firstBuy = buys.length ? buys.reduce((a, b) => (a.time < b.time ? a : b)) : null;
    return {
      base,
      group: config.settingsFor(symbol).label,
      buys: buys.length,
      sells: sells.length,
      wins: sells.filter((t) => (t.realizedPnl || 0) > 0).length,
      realized,
      amount,
      value: amount * (price || 0),
      entry,
      price,
      unrealized,
      total: realized + unrealized,
      // How the coin itself moved since we first bought it: a buy-and-hold yardstick.
      coinMovePct: firstBuy && price ? ((price - firstBuy.price) / firstBuy.price) * 100 : null,
    };
  });
  rows.sort((a, b) => a.group.localeCompare(b.group) || b.value - a.value);

  const holdingsValue = rows.reduce((sum, r) => sum + r.value, 0);
  const equity = account.cash + holdingsValue;
  const firstTrade = trades.length ? Math.min(...trades.map((t) => t.time)) : null;
  return { rows, cash: account.cash, holdingsValue, equity, pnl: equity - startingBalance, pnlPct: ((equity - startingBalance) / startingBalance) * 100, firstTrade };
}

function print(s, trades, startingBalance) {
  console.log(`Paper trading report | started with ${usd(startingBalance)}${s.firstTrade ? ` | first trade ${day(s.firstTrade)}` : ''}\n`);
  console.log(`  Account value   ${usd(s.equity)}   (${signed(s.pnl)}, ${pct(s.pnlPct)})`);
  console.log(`  Cash            ${usd(s.cash)}`);
  console.log(`  In coins        ${usd(s.holdingsValue)}\n`);

  if (!s.rows.length) {
    console.log('No trades yet. Signals change only when a coin crosses its average, so this can take a while.');
    return;
  }
  const head = ['coin', 'group', 'trades', 'won', 'closed P&L', 'open P&L', 'total', 'holding', 'coin moved'];
  const lines = s.rows.map((r) => [
    r.base,
    r.group,
    `${r.buys}b/${r.sells}s`,
    r.sells ? `${r.wins}/${r.sells}` : '-',
    r.sells ? signed(r.realized) : '-',
    r.amount > 0 ? signed(r.unrealized) : '-',
    signed(r.total),
    r.amount > 0 ? usd(r.value) : '-',
    r.coinMovePct === null ? '-' : pct(r.coinMovePct),
  ]);
  const widths = head.map((h, c) => Math.max(h.length, ...lines.map((l) => l[c].length)));
  const fmt = (cells) => cells.map((v, c) => (c < 2 ? v.padEnd(widths[c]) : v.padStart(widths[c]))).join('  ');
  console.log(fmt(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  lines.forEach((l) => console.log(fmt(l)));
  console.log('\ntrades = buys/sells. won = closed trades that made money. closed P&L = profit from sales so far.');
  console.log('open P&L = gain/loss on coins still held. coin moved = the coin\'s own price change since the first buy.');

  console.log('\nLast trades:');
  for (const t of trades.slice(0, 10)) {
    const pnl = t.realizedPnl !== undefined ? `  P&L ${signed(t.realizedPnl)}` : '';
    console.log(`  ${day(t.time)}  ${t.side.toUpperCase().padEnd(4)} ${t.symbol.padEnd(9)} ${usd(t.cost).padStart(11)} @ ${t.price.toPrecision(6)}  (${t.source})${pnl}`);
  }
  console.log('\nPaste this whole report to Claude for a review.');
}

async function main() {
  if (config.mode !== 'paper') {
    console.log('The report covers paper trading; TRADING_MODE is live.');
    return;
  }
  const account = readJson('paper-account.json', null);
  if (!account) {
    console.log('No paper account yet: start the platform first (npm start or start-trader.cmd).');
    return;
  }
  const positions = readJson('paper-positions.json', {});
  const trades = readJson('paper-trades.json', []);
  const symbols = [...new Set([...config.symbols, ...Object.keys(account.holdings || {}).map((b) => `${b}/${config.quote}`)])];
  let prices = {};
  try {
    prices = await createMarketData(config).fetchPrices(symbols);
  } catch (err) {
    console.log(`(Could not fetch current prices: ${err.message}. Open positions are shown without current value.)\n`);
  }
  print(summarize({ account, positions, trades, prices, startingBalance: config.paperStartingBalance, quote: config.quote }), trades, config.paperStartingBalance);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Report failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { summarize };
