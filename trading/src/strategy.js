// Multi-indicator signal strategy, in two modes.
//
// Each indicator votes with a weight; the votes add up to a score.
//   score >= buyThreshold   -> BUY
//   score <= sellThreshold  -> SELL
//   otherwise               -> HOLD
//
// classic: mixes trend and mean-reversion. Overbought/oversold readings
//          count against the trend, and trades exit at a fixed ATR target.
// trend:   only buys in an uptrend, treats strength as strength (no
//          "overbought" penalty), and has no fixed target: a trailing stop
//          follows the price up so winners can run.
//
// Stops are set from ATR (volatility), so they widen in choppy markets and
// tighten in calm ones.

const ind = require('./indicators');

const DEFAULTS = {
  mode: 'classic',
  buyThreshold: 3,
  sellThreshold: -3,
  stopAtrMult: 2,
  targetAtrMult: 3, // classic only
  trailAtrMult: 3, // trend only: stop trails the highest price by this many ATRs
};

const MIN_CANDLES = 210; // EMA-200 needs at least 200 bars of history

// Compute every indicator once over the whole series. The backtester reuses
// this so it can evaluate each bar without recomputing from scratch.
function computeSeries(candles) {
  const closes = candles.map((c) => c[4]);
  const highs = candles.map((c) => c[2]);
  const lows = candles.map((c) => c[3]);
  const volumes = candles.map((c) => c[5]);
  return {
    candles,
    closes,
    ema9: ind.ema(closes, 9),
    ema21: ind.ema(closes, 21),
    ema50: ind.ema(closes, 50),
    ema200: ind.ema(closes, 200),
    rsi: ind.rsi(closes, 14),
    macd: ind.macd(closes),
    bb: ind.bollinger(closes, 20, 2),
    atr: ind.atr(highs, lows, closes, 14),
    volSma: ind.sma(volumes, 20),
    volumes,
  };
}

function crossedWithin(a, b, i, lookback) {
  // Returns 1 for a bullish cross (a moved above b), -1 bearish, 0 none.
  for (let j = i; j > i - lookback && j > 0; j--) {
    if ([a[j], b[j], a[j - 1], b[j - 1]].some((v) => v === null)) continue;
    const before = a[j - 1] - b[j - 1];
    const after = a[j] - b[j];
    if (before <= 0 && after > 0) return 1;
    if (before >= 0 && after < 0) return -1;
  }
  return 0;
}

function evaluateAt(s, i, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const close = s.closes[i];
  const base = {
    signal: 'HOLD',
    score: 0,
    confidence: 0,
    price: close,
    time: s.candles[i][0],
    reasons: [],
  };
  if (i < MIN_CANDLES - 1 || s.ema200[i] === null || s.macd.histogram[i - 1] == null) {
    return { ...base, reasons: ['Not enough price history yet'] };
  }

  const reasons = [];
  let score = 0;
  const vote = (points, text) => {
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points} ${text}`);
  };
  const scored = opts.mode === 'trend' ? scoreTrend(s, i, vote) : scoreClassic(s, i, vote);
  score = scored.adjust(score, reasons);

  score = Math.round(score * 100) / 100;
  let signal = 'HOLD';
  if (score >= opts.buyThreshold && scored.canBuy) signal = 'BUY';
  else if (score <= opts.sellThreshold || scored.forceSell) signal = 'SELL';
  if (scored.note && signal !== 'BUY' && score >= opts.buyThreshold) reasons.push(scored.note);

  const a = s.atr[i];
  const r = s.rsi[i];
  const hist = s.macd.histogram;
  const trend = opts.mode === 'trend';
  return {
    ...base,
    mode: opts.mode,
    signal,
    score,
    confidence: Math.min(Math.abs(score) / 6, 1),
    reasons,
    stopLoss: close - opts.stopAtrMult * a,
    takeProfit: trend ? null : close + opts.targetAtrMult * a,
    trailAtrMult: trend ? opts.trailAtrMult : null,
    indicators: {
      rsi: r,
      ema9: s.ema9[i],
      ema21: s.ema21[i],
      ema50: s.ema50[i],
      ema200: s.ema200[i],
      macd: s.macd.line[i],
      macdSignal: s.macd.signal[i],
      macdHist: hist[i],
      bbUpper: s.bb.upper[i],
      bbMiddle: s.bb.middle[i],
      bbLower: s.bb.lower[i],
      atr: a,
    },
  };
}

// Volume confirmation amplifies whatever the other indicators say.
function volumeBoost(s, i) {
  return (score, reasons) => {
    if (s.volSma[i] && s.volumes[i] > 1.5 * s.volSma[i] && score !== 0) {
      reasons.push('x1.25 High volume confirms the move');
      return score * 1.25;
    }
    return score;
  };
}

function scoreClassic(s, i, vote) {
  const close = s.closes[i];

  // 1. Long-term trend filter
  if (close > s.ema200[i] && s.ema50[i] > s.ema200[i]) vote(1, 'Uptrend (price & EMA50 above EMA200)');
  else if (close < s.ema200[i] && s.ema50[i] < s.ema200[i]) vote(-1, 'Downtrend (price & EMA50 below EMA200)');

  // 2. Short-term momentum: EMA 9/21 crossover
  const emaCross = crossedWithin(s.ema9, s.ema21, i, 3);
  if (emaCross === 1) vote(2, 'EMA9 crossed above EMA21');
  else if (emaCross === -1) vote(-2, 'EMA9 crossed below EMA21');
  else if (s.ema9[i] > s.ema21[i]) vote(0.5, 'EMA9 above EMA21');
  else vote(-0.5, 'EMA9 below EMA21');

  // 3. MACD histogram
  const hist = s.macd.histogram;
  const zero = hist.map((v) => (v === null ? null : 0));
  const macdCross = crossedWithin(hist, zero, i, 2);
  if (macdCross === 1) vote(1.5, 'MACD bullish crossover');
  else if (macdCross === -1) vote(-1.5, 'MACD bearish crossover');
  else if (hist[i] > 0 && hist[i] > hist[i - 1]) vote(0.5, 'MACD momentum rising');
  else if (hist[i] < 0 && hist[i] < hist[i - 1]) vote(-0.5, 'MACD momentum falling');

  // 4. RSI
  const r = s.rsi[i];
  const rPrev = s.rsi[i - 1];
  if (rPrev < 30 && r >= 30) vote(2, `RSI recovering from oversold (${r.toFixed(1)})`);
  else if (r < 30) vote(1.5, `RSI oversold (${r.toFixed(1)})`);
  else if (rPrev > 70 && r <= 70) vote(-2, `RSI falling from overbought (${r.toFixed(1)})`);
  else if (r > 70) vote(-1.5, `RSI overbought (${r.toFixed(1)})`);

  // 5. Bollinger Bands
  if (close < s.bb.lower[i]) vote(1, 'Price below lower Bollinger Band');
  else if (close > s.bb.upper[i]) vote(-1, 'Price above upper Bollinger Band');

  return { canBuy: true, forceSell: false, adjust: volumeBoost(s, i) };
}

function scoreTrend(s, i, vote) {
  const close = s.closes[i];
  const uptrend = close > s.ema200[i] && s.ema50[i] > s.ema200[i];
  const downtrend = close < s.ema200[i] && s.ema50[i] < s.ema200[i];

  // 1. The trend carries the most weight
  if (uptrend) vote(2, 'Uptrend (price & EMA50 above EMA200)');
  else if (downtrend) vote(-2, 'Downtrend (price & EMA50 below EMA200)');

  // 2. Momentum: EMA 9/21
  const emaCross = crossedWithin(s.ema9, s.ema21, i, 3);
  if (emaCross === 1) vote(2, 'EMA9 crossed above EMA21');
  else if (emaCross === -1) vote(-2, 'EMA9 crossed below EMA21');
  else if (s.ema9[i] > s.ema21[i]) vote(0.5, 'EMA9 above EMA21');
  else vote(-0.5, 'EMA9 below EMA21');

  // 3. MACD histogram
  const hist = s.macd.histogram;
  const zero = hist.map((v) => (v === null ? null : 0));
  const macdCross = crossedWithin(hist, zero, i, 2);
  if (macdCross === 1) vote(1.5, 'MACD bullish crossover');
  else if (macdCross === -1) vote(-1.5, 'MACD bearish crossover');
  else if (hist[i] > 0 && hist[i] > hist[i - 1]) vote(0.5, 'MACD momentum rising');
  else if (hist[i] < 0 && hist[i] < hist[i - 1]) vote(-0.5, 'MACD momentum falling');

  // 4. RSI as a momentum gauge: strength is strength, not "overbought"
  const r = s.rsi[i];
  const rPrev = s.rsi[i - 1];
  if (uptrend && rPrev < 40 && r >= 40) vote(1.5, `Pullback over: RSI back above 40 (${r.toFixed(1)})`);
  else if (r >= 50) vote(0.5, `RSI shows bullish momentum (${r.toFixed(1)})`);
  else vote(-0.5, `RSI shows bearish momentum (${r.toFixed(1)})`);

  // 5. Breakout above the upper Bollinger Band in an uptrend
  if (uptrend && close > s.bb.upper[i]) vote(0.5, 'Breaking out above upper Bollinger Band');

  // A close below EMA50 means the trend that justified holding is broken.
  const trendBroken = s.closes[i - 1] >= s.ema50[i - 1] && close < s.ema50[i];
  if (trendBroken) vote(-1, 'Closed below EMA50 (trend weakening)');

  return {
    canBuy: uptrend,
    forceSell: trendBroken && !uptrend,
    note: uptrend ? null : 'Trend mode only buys in an uptrend',
    adjust: volumeBoost(s, i),
  };
}

// Scores every candle once for a given mode. The score doesn't depend on
// thresholds or stop sizes, so the optimizer can try many of those cheaply.
function scoreSeries(s, mode) {
  const out = { mode, score: [], canBuy: [], forceSell: [] };
  // Thresholds that never trigger, so we can read canBuy/forceSell separately.
  const probe = { mode, buyThreshold: -Infinity, sellThreshold: -Infinity };
  for (let i = 0; i < s.closes.length; i++) {
    const r = evaluateAt(s, i, probe);
    out.score[i] = r.score;
    out.canBuy[i] = Boolean(r.indicators) && r.signal === 'BUY';
    out.forceSell[i] = r.signal === 'SELL';
  }
  return out;
}

// The parts of evaluateAt the backtester needs, from cached scores.
function signalFromScore(scores, i, s, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const score = scores.score[i];
  let signal = 'HOLD';
  if (score >= opts.buyThreshold && scores.canBuy[i]) signal = 'BUY';
  else if (score <= opts.sellThreshold || scores.forceSell[i]) signal = 'SELL';
  const close = s.closes[i];
  const a = s.atr[i];
  const trend = opts.mode === 'trend';
  return {
    signal,
    score,
    stopLoss: close - opts.stopAtrMult * a,
    takeProfit: trend ? null : close + opts.targetAtrMult * a,
    trailAtrMult: trend ? opts.trailAtrMult : null,
  };
}

function analyze(candles, options) {
  if (candles.length === 0) throw new Error('No candles to analyze');
  return evaluateAt(computeSeries(candles), candles.length - 1, options);
}

module.exports = { analyze, computeSeries, evaluateAt, scoreSeries, signalFromScore, MIN_CANDLES };
