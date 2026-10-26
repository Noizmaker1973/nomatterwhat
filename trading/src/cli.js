// Quick terminal check of current signals:  npm run signals

const config = require('./config');
const { createMarketData } = require('./marketData');
const { analyze } = require('./strategy');

async function main() {
  const marketData = createMarketData(config);
  console.log(`Signals | ${marketData.name}\n`);
  const rows = await Promise.all(
    config.symbols.map(async (symbol) => {
      const { label, timeframe, strategy } = config.settingsFor(symbol);
      try {
        const candles = await marketData.fetchCandles(symbol, timeframe, config.candleLimit);
        const s = analyze(candles.slice(0, -1), strategy);
        return {
          symbol,
          group: `${label} ${timeframe} ${strategy.mode}`,
          signal: s.signal,
          score: s.score,
          price: Number(candles[candles.length - 1][4].toFixed(2)),
          rsi: s.indicators?.rsi?.toFixed(1),
          stop: s.stopLoss?.toFixed(2) ?? '—',
          target: s.takeProfit?.toFixed(2) ?? '—',
          why: s.reasons.slice(0, 2).join(' | '),
        };
      } catch (err) {
        return { symbol, signal: 'ERROR', why: err.message };
      }
    })
  );
  console.table(rows);
}

main();
