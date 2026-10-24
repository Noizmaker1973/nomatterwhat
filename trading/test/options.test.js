const test = require('node:test');
const assert = require('node:assert');
const { optionIdea, bsPrice, normCdf, probAbove, realizedVol, roundStrike } = require('../src/options');

const close = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('normal CDF and Black-Scholes match textbook values', () => {
  close(normCdf(0), 0.5, 1e-7);
  close(normCdf(1.96), 0.975, 1e-4);
  // S=K=100, 1 year, 20% vol, r=0: call = put = 7.966
  close(bsPrice('call', 100, 100, 1, 0.2), 7.9656, 1e-3);
  close(bsPrice('put', 100, 100, 1, 0.2), 7.9656, 1e-3);
});

test('put-call parity holds (r = 0): C - P = S - K', () => {
  for (const K of [80, 100, 130]) close(bsPrice('call', 100, K, 0.25, 0.6) - bsPrice('put', 100, K, 0.25, 0.6), 100 - K, 1e-6);
});

test('realized volatility annualizes daily returns', () => {
  // Alternating +1% / -1% daily moves = 1% daily sd = ~19% a year
  const closes = [100];
  for (let i = 0; i < 40; i++) closes.push(closes.at(-1) * (i % 2 ? 1.01 : 0.99));
  close(realizedVol(closes, 86400e3), 0.01 * Math.sqrt(365), 0.01);
});

test('ideas match the direction and have limited, consistent risk', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 * Math.exp(0.03 * Math.sin(i)));
  const args = { price: 100, closes, tfMs: 86400e3 };

  const put = optionIdea({ ...args, direction: 'bullish', holding: false });
  assert.strictEqual(put.strategy, 'cash-secured-put');
  assert.ok(put.legs[0].strike < 100 && put.credit > 0);
  close(put.breakeven, put.legs[0].strike - put.credit, 1e-9);

  const call = optionIdea({ ...args, direction: 'bullish', holding: true });
  assert.strictEqual(call.strategy, 'covered-call');
  assert.ok(call.legs[0].strike > 100);

  const spread = optionIdea({ ...args, direction: 'bearish', holding: false });
  assert.strictEqual(spread.strategy, 'bear-call-spread');
  const [sold, bought] = spread.legs;
  assert.ok(sold.strike > 100 && bought.strike > sold.strike);
  close(spread.credit + spread.maxLoss, bought.strike - sold.strike, 1e-9);
  assert.ok(spread.probProfit > 0.5 && spread.probProfit < 1);
});

test('strikes round to a sensible grid', () => {
  assert.strictEqual(roundStrike(77432, 77432), 77000);
  assert.strictEqual(roundStrike(3912, 3912), 3900);
  assert.strictEqual(roundStrike(176.4, 176.4), 180);
  assert.ok(probAbove(100, 100, 0.1, 0.5) < 0.5, 'zero-drift lognormal median is below the spot');
});
