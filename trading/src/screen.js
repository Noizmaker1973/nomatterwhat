// Screener: suggests volatile, top-50 coins for the day-trading group.
//
//   npm run screen
//   npm run screen -- --top 5 --max-rank 30
//
// Uses your exchange's coin list and 24h volume (via CCXT), CoinGecko's free
// market-cap ranking, and each coin's last 30 daily candles for volatility.
// If CoinGecko can't be reached, it falls back to ranking by trading volume.

const config = require('./config');
const { createExchange } = require('./marketData');
const { realizedVol } = require('./options');

// Stablecoins and wrapped/staked copies of other coins: no use for day trading.
const EXCLUDE = new Set([
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'PYUSD', 'USDS', 'USDE', 'USD1', 'RLUSD', 'EURC', 'EUR', 'GBP',
  'WBTC', 'WETH', 'WBETH', 'STETH', 'WSTETH', 'CBBTC', 'CBETH', 'WEETH', 'BETH',
]);
const MIN_VOLUME = 100000; // 24h volume in quote currency; thinner markets fill badly
const DAY_MS = 86400e3;

// Coins tradable against the quote currency, excluding the ones already used.
function candidateMarkets(markets, quote, exclude) {
  return Object.values(markets)
    .filter((m) => m.spot !== false && m.active !== false && m.quote === quote)
    .filter((m) => !EXCLUDE.has(m.base) && !exclude.includes(m.base))
    .map((m) => ({ symbol: m.symbol, base: m.base }));
}

// Adds market-cap rank and volume, then keeps liquid coins within the rank limit.
// Without ranks (CoinGecko unreachable), the top `maxRank` coins by volume stand in.
function filterByRank(candidates, tickers, ranks, maxRank, minVolume = MIN_VOLUME) {
  const withData = candidates
    .map((c) => ({ ...c, volume: tickers[c.symbol]?.quoteVolume || 0, rank: ranks ? ranks[c.base] ?? null : null }))
    .filter((c) => c.volume >= minVolume);
  if (ranks) return withData.filter((c) => c.rank !== null && c.rank <= maxRank);
  return withData.sort((a, b) => b.volume - a.volume).slice(0, maxRank);
}

// Annualized volatility (%) and average daily high-low range (%) from daily candles.
function volatilityStats(candles) {
  const closes = candles.map((c) => c[4]);
  const vol = realizedVol(closes, DAY_MS, 30);
  const ranges = candles.slice(-30).map(([, , h, l, c]) => ((h - l) / c) * 100);
  return {
    volatilityPct: vol === null ? null : vol * 100,
    avgRangePct: ranges.reduce((a, b) => a + b, 0) / ranges.length,
  };
}

// CoinGecko symbol -> market-cap rank (top 250). Symbols can be shared by
// several tokens; the highest-ranked one wins.
async function fetchMarketCapRanks() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1';
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
  const ranks = {};
  for (const coin of await res.json()) {
    const sym = String(coin.symbol).toUpperCase();
    if (coin.market_cap_rank && !(sym in ranks)) ranks[sym] = coin.market_cap_rank;
  }
  return ranks;
}

function parseArgs(argv) {
  const args = { top: 3, maxRank: 50, minVolume: MIN_VOLUME };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--top') args.top = parseInt(argv[++i], 10);
    else if (argv[i] === '--max-rank') args.maxRank = parseInt(argv[++i], 10);
    else if (argv[i] === '--min-volume') args.minVolume = parseFloat(argv[++i]);
  }
  return args;
}

const money = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const exchange = createExchange(config);
  const mainBases = config.groupNamed('main').symbols.map((s) => s.split('/')[0]);
  console.log(`Screener | ${exchange.id} | ${config.quote} pairs | top ${args.maxRank} by market cap | excluding ${mainBases.join(', ')}\n`);

  await exchange.loadMarkets();
  const candidates = candidateMarkets(exchange.markets, config.quote, mainBases);
  const tickers = await exchange.fetchTickers();

  let ranks = null;
  try {
    ranks = await fetchMarketCapRanks();
  } catch (err) {
    console.log(`Could not reach CoinGecko (${err.message}); using 24h trading volume instead of market cap.\n`);
  }
  const shortlist = filterByRank(candidates, tickers, ranks, args.maxRank, args.minVolume);
  // Top-ranked coins the exchange lists but barely trades: shown so you know they exist.
  const thin = ranks
    ? candidates
        .map((c) => ({ ...c, volume: tickers[c.symbol]?.quoteVolume || 0, rank: ranks[c.base] ?? null }))
        .filter((c) => c.rank !== null && c.rank <= args.maxRank && c.volume < args.minVolume)
        .sort((a, b) => a.rank - b.rank)
    : [];
  if (thin.length) {
    console.log(`Skipped for low trading volume on ${exchange.id} (under ${money(args.minVolume)} ${config.quote} a day):`);
    console.log(`  ${thin.map((c) => `${c.base} #${c.rank} (${money(c.volume)})`).join(', ')}`);
    console.log('  Lower the cutoff with --min-volume (e.g. --min-volume 25000) to include them, at the cost of worse fills.\n');
  }
  if (!shortlist.length) {
    console.log('No coins matched. Try --max-rank 100 or a lower --min-volume.');
    return;
  }

  process.stdout.write(`Measuring volatility of ${shortlist.length} coins`);
  const rows = [];
  for (const c of shortlist) {
    try {
      const candles = await exchange.fetchOHLCV(c.symbol, '1d', undefined, 31);
      if (candles.length >= 15) rows.push({ ...c, ...volatilityStats(candles) });
    } catch {
      // skip coins whose history can't be loaded
    }
    process.stdout.write('.');
  }
  console.log('\n');

  rows.sort((a, b) => (b.volatilityPct ?? 0) - (a.volatilityPct ?? 0));
  console.table(
    rows.slice(0, 12).map((r, i) => ({
      pick: i < args.top ? '★' : '',
      coin: r.base,
      'mcap rank': r.rank ?? '—',
      '24h volume': money(r.volume),
      'volatility %/yr': r.volatilityPct?.toFixed(0),
      'avg daily range %': r.avgRangePct.toFixed(1),
    }))
  );
  const picks = rows.slice(0, args.top).map((r) => r.base);
  console.log('\nMost volatile = biggest daily swings: more opportunity, and more risk. Check the volume column;');
  console.log('low-volume coins fill at worse prices. Before trusting signals on them, test them:\n');
  console.log(`  npm run optimize -- ${picks.join(' ')} --group day`);
  console.log('\nTo add them to the dashboard as day-trading coins (signals only unless DAY_AUTO_TRADE=true):\n');
  console.log(`  npm run configure -- DAY_SYMBOLS=${picks.join(',')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Screener failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { candidateMarkets, filterByRank, volatilityStats, EXCLUDE, MIN_VOLUME };
