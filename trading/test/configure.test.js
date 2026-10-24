const test = require('node:test');
const assert = require('node:assert');
const { applyUpdates, parseAssignments } = require('../src/configure');

const env = [
  '# keys',
  'EXCHANGE_API_KEY=abc123',
  'TIMEFRAME=1h',
  'RISK_PER_TRADE_PCT=1        # % of equity lost at the stop',
  'BUY_THRESHOLD=3',
  '',
].join('\r\n'); // Windows line endings, as Notepad saves them

test('changes existing lines in place, keeps comments and keys, appends new ones', () => {
  const { text, changes } = applyUpdates(env, parseAssignments(['TIMEFRAME=1d', 'buy_threshold=0', 'STRATEGY_MODE=ma', 'RISK_PER_TRADE_PCT=2']));
  const lines = text.split('\n');
  assert.ok(lines.includes('EXCHANGE_API_KEY=abc123'));
  assert.ok(lines.includes('# keys'));
  assert.ok(lines.includes('TIMEFRAME=1d'));
  assert.ok(lines.includes('BUY_THRESHOLD=0'));
  assert.ok(lines.includes('RISK_PER_TRADE_PCT=2        # % of equity lost at the stop'));
  assert.ok(lines.includes('STRATEGY_MODE=ma'));
  assert.strictEqual(lines.filter((l) => l.startsWith('TIMEFRAME=')).length, 1);
  assert.deepStrictEqual(changes, [
    'changed TIMEFRAME: 1h -> 1d',
    'changed BUY_THRESHOLD: 3 -> 0',
    'added   STRATEGY_MODE=ma',
    'changed RISK_PER_TRADE_PCT: 1 -> 2',
  ]);
});

test('negative values and repeated runs work', () => {
  const once = applyUpdates(env, parseAssignments(['SELL_THRESHOLD=-3'])).text;
  const twice = applyUpdates(once, parseAssignments(['SELL_THRESHOLD=-3']));
  assert.strictEqual(twice.text, once);
  assert.deepStrictEqual(twice.changes, ['same    SELL_THRESHOLD=-3']);
});

test('rejects malformed input', () => {
  assert.throws(() => parseAssignments(['TIMEFRAME']), /KEY=VALUE/);
});
