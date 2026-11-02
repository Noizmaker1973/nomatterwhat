const test = require('node:test');
const assert = require('node:assert');
const { summarize } = require('../src/report');

test('report: account value, closed and open P&L per coin', () => {
  const trades = [
    { symbol: 'ETH/USDT', side: 'sell', price: 110, cost: 1100, realizedPnl: 98, time: 3 },
    { symbol: 'ETH/USDT', side: 'buy', price: 100, cost: 1000, time: 1 },
    { symbol: 'BTC/USDT', side: 'buy', price: 50, cost: 2000, time: 2 },
  ];
  const s = summarize({
    account: { cash: 8098, holdings: { BTC: 40 } },
    positions: { 'BTC/USDT': { entryPrice: 50 } },
    trades,
    prices: { 'BTC/USDT': 55, 'ETH/USDT': 120 },
    startingBalance: 10000,
    quote: 'USDT',
  });
  assert.strictEqual(s.equity, 8098 + 40 * 55);
  assert.ok(Math.abs(s.pnl - 298) < 1e-9);
  const eth = s.rows.find((r) => r.base === 'ETH');
  const btc = s.rows.find((r) => r.base === 'BTC');
  assert.deepStrictEqual([eth.buys, eth.sells, eth.wins, eth.realized, eth.amount], [1, 1, 1, 98, 0]);
  assert.strictEqual(btc.unrealized, 200);
  assert.strictEqual(btc.coinMovePct, 10);
  assert.strictEqual(s.firstTrade, 1);
});
