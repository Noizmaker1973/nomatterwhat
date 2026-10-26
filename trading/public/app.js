const $ = (sel, el = document) => el.querySelector(sel);
const state = { status: null, cards: {}, candles: {}, prices: {}, lastScanAt: null, alerts: [], lastSnapshotAt: 0 };

// ---------------------------------------------------------------- helpers

function fmt(n, digits) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const d = digits ?? (abs >= 1000 ? 2 : abs >= 1 ? 3 : 5);
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
const money = (n) => fmt(n, 2);
const time = (t) => new Date(t).toLocaleTimeString();
const dateTime = (t) => new Date(t).toLocaleString();

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => (k === 'class' ? (node.className = v) : node.setAttribute(k, v)));
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.status?.tokenRequired) {
    let token = localStorage.getItem('dashboardToken');
    if (!token && options.method === 'POST') {
      token = prompt('Dashboard token (DASHBOARD_TOKEN from .env):') || '';
      localStorage.setItem('dashboardToken', token);
    }
    if (token) headers['x-dashboard-token'] = token;
  }
  const res = await fetch(`/api${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) localStorage.removeItem('dashboardToken');
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}
const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data || {}) });

// ----------------------------------------------------------------- status

// "1d candles · ma strategy", or per group when day trading is on.
function describeGroups(s) {
  const groups = s.groups || [];
  if (groups.length < 2) return `${s.timeframe} candles · ${s.strategy?.mode || 'classic'} strategy`;
  return groups
    .map((g) => `${g.label}: ${g.timeframe} ${g.mode}${g.name === 'day' && !g.autoTrade ? ' (signals only)' : ''}`)
    .join(' · ');
}

function renderStatus(s) {
  state.status = s;
  const badge = $('#modeBadge');
  badge.textContent = s.mode === 'live' ? 'LIVE TRADING' : 'PAPER';
  badge.className = `badge ${s.mode}`;
  $('#autoTrade').checked = s.autoTrade;
  $('#resetBtn').classList.toggle('hidden', s.mode !== 'paper');
  $('#meta').textContent =
    `${s.exchange} · data: ${s.dataSource} · ${describeGroups(s)} · ` +
    `last analysis ${s.lastScanAt ? time(s.lastScanAt) : '—'}`;

  const banner = $('#banner');
  const messages = [];
  if (s.mode === 'live') messages.push('LIVE MODE: orders use real money on your exchange account.');
  if (s.liveRequestedButUnconfirmed) messages.push('TRADING_MODE=live is set but CONFIRM_LIVE_TRADING is not "yes" — running in paper mode.');
  if (s.guard?.halted) messages.push(`Daily loss limit reached (${fmt(s.guard.drawdownPct, 2)}% down today). New buys are paused.`);
  const errs = Object.entries(s.errors || {});
  if (errs.length) messages.push(`Data errors: ${errs.map(([sym, e]) => `${sym}: ${e}`).join(' | ')}`);
  if (s.dataSource === 'demo') messages.push('DEMO DATA: prices are synthetic. Run npm start for real markets.');
  banner.textContent = messages.join('  •  ');
  banner.classList.toggle('hidden', messages.length === 0);
  banner.classList.toggle('danger', s.mode === 'live' || s.guard?.halted);

  const scanChanged = s.lastScanAt !== state.lastScanAt;
  state.lastScanAt = s.lastScanAt;
  return scanChanged;
}

// ---------------------------------------------------------------- signals

function getCard(symbol) {
  if (state.cards[symbol]) return state.cards[symbol];
  const node = $('#cardTpl').content.firstElementChild.cloneNode(true);
  $('.sym', node).textContent = symbol;
  $('.buy', node).addEventListener('click', () => order(symbol, 'buy', node));
  $('.chart', node).addEventListener('click', () => selectChart(symbol, true));
  $('.chart', node).title = 'Show on the big chart';
  $('.sell', node).addEventListener('click', () => order(symbol, 'sell', node));
  $('#signals').appendChild(node);
  state.cards[symbol] = node;
  return node;
}

function renderSignals(signals) {
  for (const s of signals) {
    const card = getCard(s.symbol);
    card.className = `card ${s.signal}`;
    renderGroupTag(card, s);
    renderPrice(card, s.symbol, s.livePrice);
    const badge = $('.signal', card);
    badge.textContent = s.signal;
    badge.className = `signal ${s.signal}`;

    renderGauge(card, s);
    renderSuggestion(card, s);
    renderOptionIdea(card, s);

    const i = s.indicators || {};
    const stats = $('.stats', card);
    stats.replaceChildren();
    const rows = s.mode === 'ma'
      ? [
          [`MA ${i.maPeriod}`, fmt(i.ma)],
          ['RSI', fmt(i.rsi, 1)],
          ['EMA 21', fmt(i.ema21)],
          ['ATR', fmt(i.atr)],
        ]
      : [
          ['RSI', fmt(i.rsi, 1)],
          ['ATR', fmt(i.atr)],
          ['EMA 21', fmt(i.ema21)],
          ['EMA 200', fmt(i.ema200)],
          ['Stop', fmt(s.stopLoss)],
          ['Target', fmt(s.takeProfit)],
        ];
    rows.forEach(([k, v]) => {
      const row = el('div');
      row.append(el('dt', {}, k), el('dd', {}, v));
      stats.appendChild(row);
    });

    const reasons = $('.reasons', card);
    reasons.replaceChildren(...(s.reasons || []).map((r) => el('li', {}, r)));
  }
}

// The gauge spans scores -range..+range, with the SELL and BUY zones starting
// at the configured trigger levels. In moving-average mode the score is a %
// distance from the average, which swings wider, so the gauge does too.
let gaugeRange = 8;
const gaugePos = (v) => 50 + (Math.max(-gaugeRange, Math.min(gaugeRange, v)) / gaugeRange) * 50;

function renderGauge(card, s) {
  const { buyThreshold: buy = 3, sellThreshold: sell = -3 } = s.settings || state.status?.strategy || {};
  const score = s.score || 0;
  gaugeRange = s.mode === 'ma' ? 20 : 8;
  const sellPos = gaugePos(sell);
  const buyPos = gaugePos(buy);

  $('.zone.sell', card).style.width = `${sellPos}%`;
  $('.zone.buy', card).style.left = `${buyPos}%`;
  $('.tick.sell', card).style.left = `${sellPos}%`;
  $('.tick.buy', card).style.left = `${buyPos}%`;
  const marker = $('.marker.closed', card);
  marker.style.left = `${gaugePos(score)}%`;
  marker.className = `marker closed ${s.signal}`;
  // Hollow ring = provisional score including the candle that is still forming.
  const live = s.live;
  const liveMarker = $('.marker.live', card);
  const showLive = live && live.score !== score;
  liveMarker.classList.toggle('hidden', !showLive);
  if (showLive) liveMarker.style.left = `${gaugePos(live.score)}%`;

  // Labels sit on the outer side of their trigger line so they never overlap.
  const sellLbl = $('.lbl.sell', card);
  sellLbl.textContent = `SELL ≤ ${sell}`;
  sellLbl.style.right = `${100 - Math.max(sellPos, 22)}%`;
  const buyLbl = $('.lbl.buy', card);
  buyLbl.textContent = `BUY ≥ ${buy}`;
  buyLbl.style.left = `${Math.min(buyPos, 78)}%`;
  const holdLbl = $('.lbl.hold', card);
  holdLbl.style.left = `${(sellPos + buyPos) / 2}%`;
  holdLbl.classList.toggle('hidden', buyPos - sellPos < 22);

  const round = (n) => Math.round(n * 100) / 100;
  const ma = s.mode === 'ma';
  sellLbl.textContent = `SELL ≤ ${sell}${ma ? '%' : ''}`;
  buyLbl.textContent = `BUY ≥ ${buy}${ma ? '%' : ''}`;
  if (ma) {
    const side = score >= 0 ? 'above' : 'below';
    $('.score-label', card).textContent = `Price is ${Math.abs(score)}% ${side} its ${s.indicators?.maPeriod}-candle average`;
    $('.live-label', card).textContent = showLive ? `Live: ${live.score}% (candle still forming)` : '';
    return;
  }
  let distance;
  if (score >= buy && s.signal !== 'BUY') distance = 'above BUY level, but no uptrend (trend mode)';
  else if (score >= buy) distance = 'in the BUY zone';
  else if (score <= sell) distance = 'in the SELL zone';
  else distance = `${round(buy - score)} pts to BUY · ${round(score - sell)} pts to SELL`;
  $('.score-label', card).textContent =
    `Score ${score} · ${distance} · confidence ${Math.round((s.confidence || 0) * 100)}%`;
  $('.live-label', card).textContent = showLive
    ? `Live: ${live.score} (candle still forming)`
    : '';
}

// With day trading on, each card says which group it belongs to.
function renderGroupTag(card, s) {
  const tag = $('.group-tag', card);
  const g = s.settings;
  const show = g && (state.status?.groups || []).length > 1;
  tag.classList.toggle('hidden', !show);
  if (!show) return;
  tag.textContent = `${g.label} · ${g.timeframe}${g.group === 'day' && !g.autoTrade ? ' · signals only' : ''}`;
  tag.className = `group-tag ${g.group}`;
}

function renderPrice(card, symbol, price) {
  const node = $('.price', card);
  node.textContent = price ? fmt(price) : '…';
  const prev = state.prices[symbol];
  if (prev && price && price !== prev) {
    node.classList.remove('up', 'down');
    void node.offsetWidth; // restart the flash animation
    node.classList.add(price > prev ? 'up' : 'down');
  }
  state.prices[symbol] = price;
}

function renderSuggestion(card, s) {
  const box = $('.suggest', card);
  const head = $('.suggest-head', box);
  const body = $('.suggest-body', box);
  const btn = $('.suggest-btn', box);
  const g = s.suggestion;
  const coin = s.symbol.split('/')[0];
  const quote = state.status?.quote || '';
  const lines = [];
  box.className = `suggest ${g ? g.action : 'WAIT'}`;
  btn.className = 'btn small suggest-btn hidden'; // BUY/SELL below make it visible
  if (!g) {
    head.textContent = 'Suggested trade: waiting for data';
  } else if (g.action === 'BUY') {
    head.textContent = `Suggested: BUY ${money(g.quoteAmount)} ${quote} of ${coin}`;
    lines.push(`≈ ${fmt(g.baseAmount, 6)} ${coin} · ${fmt(g.equityPct, 1)}% of account`);
    if (g.mode === 'ma') {
      lines.push(
        `No stop-loss or target: hold until the price closes ${Math.abs(g.sellThreshold)}% or more below its ${g.maPeriod}-candle average (now ${fmt(g.ma)})`
      );
    } else {
      lines.push(`Stop ${fmt(g.stopLoss)} (${fmt(g.stopPct, 2)}%) · max loss ${money(g.riskAmount)}`);
    }
    if (g.mode === 'ma') {
      // nothing more: the average is the exit
    } else if (g.trailAtrMult) {
      lines.push(`No fixed target: the stop trails ${fmt(g.trailDistance)} below the highest price, so it only moves up`);
    } else {
      lines.push(
        `Target ${fmt(g.takeProfit)} (+${fmt(g.targetPct, 2)}%) · gain ${money(g.rewardAmount)}`,
        `Reward : risk ${fmt(g.rewardRisk, 1)} : 1 (before fees)`
      );
    }
    btn.textContent = 'Place this trade';
    btn.className = 'btn small suggest-btn buy';
    btn.onclick = () => order(s.symbol, 'buy', card, { quoteAmount: g.quoteAmount });
  } else if (g.action === 'SELL') {
    head.textContent = `Suggested: SELL all ${fmt(g.baseAmount, 6)} ${coin} (≈ ${money(g.quoteAmount)} ${quote})`;
    if (g.pnl !== null && g.pnl !== undefined) {
      lines.push(`Profit/loss if sold now: ${g.pnl >= 0 ? '+' : ''}${money(g.pnl)} (${fmt(g.pnlPct, 2)}%)`);
    }
    btn.textContent = 'Place this trade';
    btn.className = 'btn small suggest-btn sell';
    btn.onclick = () => order(s.symbol, 'sell', card, { percent: 100 });
  } else if (g.action === 'KEEP') {
    head.textContent = 'Suggested: keep holding';
    let exit = `Stop-loss ${fmt(g.stopLoss)} · take-profit ${fmt(g.takeProfit)}`;
    if (g.mode === 'ma') exit = `Exits when the price closes below its ${g.maPeriod}-candle average`;
    else if (g.trailing) exit = `Trailing stop ${fmt(g.stopLoss)} (moves up with the price)`;
    lines.push(g.note, exit);
  } else if (g.action === 'AVOID') {
    head.textContent = "Suggested: don't buy";
    lines.push(g.note);
  } else {
    head.textContent = 'Suggested: no trade right now';
    lines.push(g.note);
  }
  body.replaceChildren(...lines.map((l) => el('div', {}, l)));
}

// Estimated with Black-Scholes from recent volatility; see src/options.js.
function renderOptionIdea(card, s) {
  const box = $('.options', card);
  const o = s.optionIdea;
  box.classList.toggle('hidden', !o);
  if (!o) return;
  const legs = o.legs.map((l) => `${l.action === 'sell' ? 'Sell' : 'Buy'} ${l.type} ${fmt(l.strike, 0)} (~${money(l.premium)})`).join(' · ');
  const lines = [
    [o.title, `${legs}, ${o.expiryDays} days`],
    ['You collect', `~${money(o.credit)} per coin${o.yieldPct ? ` (${fmt(o.yieldPct, 1)}% in ${o.expiryDays} days)` : ''}`],
    ['Breakeven', fmt(o.breakeven)],
    ['Max loss', o.strategy === 'bear-call-spread' ? `${money(o.maxLoss)} per coin (capped)` : `${money(o.maxLoss)} per coin if the price went to zero`],
    ['Chance of profit', `~${Math.round(o.probProfit * 100)}% (model)`],
  ];
  const body = $('.options-body', box);
  body.replaceChildren(
    ...lines.map(([k, v]) => {
      const row = el('div', { class: 'opt-row' });
      row.append(el('span', {}, k), el('b', {}, v));
      return row;
    }),
    el('p', {}, o.summary),
    el(
      'p',
      { class: 'opt-note' },
      `Estimate from ${fmt(o.volatilityPct, 0)}% recent volatility. Real option prices differ, and usually pay more. ` +
        'Binance.US has no options, so this is for planning only; check real quotes before trading.'
    )
  );
}

async function loadCandles(symbol) {
  try {
    state.candles[symbol] = await api(`/candles?symbol=${encodeURIComponent(symbol)}&limit=120`);
    drawChart(symbol);
  } catch {
    // Candles appear after the first analysis completes.
  }
}

function drawChart(symbol) {
  const canvas = $('.chart', getCard(symbol));
  const candles = state.candles[symbol];
  if (!candles?.length) return;
  const closes = candles.map((c) => c[4]);
  const ema = (period) => {
    const k = 2 / (period + 1);
    let prev = closes[0];
    return closes.map((v) => (prev = v * k + prev * (1 - k)));
  };
  const series = [
    { data: closes, color: '#e6edf3', width: 1.5 },
    { data: ema(21), color: '#58a6ff', width: 1 },
    { data: ema(50), color: '#d29922', width: 1 },
  ];
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight || 110;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const all = series.flatMap((s) => s.data);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const x = (idx) => (idx / (closes.length - 1)) * w;
  const y = (v) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
  for (const s of series) {
    ctx.beginPath();
    s.data.forEach((v, idx) => (idx ? ctx.lineTo(x(idx), y(v)) : ctx.moveTo(x(idx), y(v))));
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.stroke();
  }
}

// -------------------------------------------------------------- portfolio

function renderPortfolio(p) {
  const invested = p.positions.reduce((a, x) => a + x.value, 0);
  const unrealized = p.positions.reduce((a, x) => a + (x.pnl || 0), 0);
  const summary = $('#portfolioSummary');
  summary.replaceChildren();
  [
    ['Total equity', `${money(p.equity)} ${p.quote}`],
    ['Cash', `${money(p.cash)} ${p.quote}`],
    ['In positions', `${money(invested)} ${p.quote}`],
    ['Unrealized P&L', `${unrealized >= 0 ? '+' : ''}${money(unrealized)}`, unrealized >= 0 ? 'pos' : 'neg'],
  ].forEach(([label, value, cls]) => {
    const div = el('div');
    div.append(el('span', {}, label), el('strong', cls ? { class: cls } : {}, value));
    summary.appendChild(div);
  });

  const tbody = $('#positions');
  tbody.replaceChildren();
  if (!p.positions.length) {
    const tr = el('tr');
    tr.appendChild(el('td', { colspan: 7, class: 'empty' }, 'No open positions'));
    tbody.appendChild(tr);
    return;
  }
  for (const pos of p.positions) {
    const tr = el('tr');
    const pnlCls = pos.pnl >= 0 ? 'pos' : 'neg';
    tr.append(
      el('td', {}, pos.symbol.split('/')[0]),
      el('td', {}, fmt(pos.amount, 6)),
      el('td', {}, money(pos.value)),
      el('td', {}, fmt(pos.entryPrice)),
      el('td', { class: pnlCls }, pos.pnl === null ? '—' : `${money(pos.pnl)} (${fmt(pos.pnlPct, 2)}%)`)
    );
    for (const field of ['stopLoss', 'takeProfit']) {
      const td = el('td');
      let text = fmt(pos[field]);
      if (field === 'stopLoss' && pos.trailing) text += ' ↑';
      if (field === 'takeProfit' && pos.trailing && pos[field] === null) text = 'trailing';
      const title = field === 'stopLoss' && pos.trailing ? 'Trailing stop: rises with the price, never falls. Click to change' : 'Click to change';
      const span = el('span', { class: 'editable', title }, text);
      span.addEventListener('click', () => editStop(pos.symbol, field, pos[field]));
      td.appendChild(span);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function renderAlerts(alerts) {
  $('#alerts').replaceChildren(
    ...alerts.map((a) => {
      const li = el('li', { class: `alert-${a.type}` });
      li.append(el('time', {}, time(a.time)), document.createTextNode(a.text));
      return li;
    })
  );
}

function renderTrades(trades) {
  const tbody = $('#trades');
  tbody.replaceChildren();
  if (!trades.length) {
    const tr = el('tr');
    tr.appendChild(el('td', { colspan: 8, class: 'empty' }, 'No trades yet'));
    tbody.appendChild(tr);
    return;
  }
  for (const t of trades.slice(0, 100)) {
    const tr = el('tr');
    const pnl = t.realizedPnl;
    tr.append(
      el('td', {}, dateTime(t.time)),
      el('td', { class: t.side === 'buy' ? 'pos' : 'neg' }, t.side.toUpperCase()),
      el('td', {}, t.symbol),
      el('td', {}, fmt(t.amount, 6)),
      el('td', {}, fmt(t.price)),
      el('td', {}, money(t.cost)),
      el('td', pnl === undefined ? {} : { class: pnl >= 0 ? 'pos' : 'neg' }, pnl === undefined ? '—' : money(pnl)),
      el('td', {}, t.source)
    );
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------- actions

async function order(symbol, side, card, overrides = {}) {
  const live = state.status?.mode === 'live';
  const payload = { symbol, side };
  let description;
  if (side === 'buy') {
    const amount = overrides.quoteAmount ?? parseFloat($('.buyAmt', card).value);
    if (amount > 0) payload.quoteAmount = amount;
    description = `BUY ${symbol} for ${amount > 0 ? `${money(amount)} ${state.status.quote}` : 'an auto-sized amount (risk rules)'}`;
  } else {
    payload.percent = overrides.percent ?? Number($('.sellPct', card).value);
    description = `SELL ${payload.percent}% of your ${symbol.split('/')[0]}`;
  }
  if (!confirm(`${live ? '⚠️ LIVE ORDER — real money\n\n' : 'Paper order\n\n'}${description}?`)) return;

  const buttons = card.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await post('/order', payload);
    $('.buyAmt', card).value = '';
    await Promise.all([refresh(), loadTrades()]);
  } catch (err) {
    alert(`Order failed: ${err.message}`);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function editStop(symbol, field, current) {
  const label = field === 'stopLoss' ? 'stop-loss' : 'take-profit';
  const value = prompt(`New ${label} price for ${symbol} (empty to remove):`, current ?? '');
  if (value === null) return;
  try {
    await post('/stops', { symbol, [field]: value.trim() === '' ? null : Number(value) });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

$('#autoTrade').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const live = state.status?.mode === 'live';
  if (enabled && !confirm(`Enable auto-trading${live ? ' with REAL MONEY' : ''}?\n\nThe platform will buy and sell automatically on signals.`)) {
    e.target.checked = false;
    return;
  }
  try {
    await post('/auto-trade', { enabled });
  } catch (err) {
    e.target.checked = !enabled;
    alert(err.message);
  }
});

$('#scanBtn').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    await post('/scan');
    await refresh();
  } catch (err) {
    alert(err.message);
  } finally {
    e.target.disabled = false;
  }
});

$('#resetBtn').addEventListener('click', async () => {
  if (!confirm('Reset the paper account? All paper positions and history will be cleared.')) return;
  await post('/paper/reset').catch((err) => alert(err.message));
  refresh();
  loadTrades();
});

// -------------------------------------------------------------- big chart
// TradingView's open-source Lightweight Charts, served from node_modules.

const COLORS = { up: '#3fb68b', down: '#e5636b', trade: '#58a6ff', muted: '#8b949e', grid: 'rgba(48, 54, 61, 0.35)', border: '#30363d' };
const big = { api: null, candles: null, lines: [], priceLines: [], symbol: null, data: null };
const toSec = (ms) => Math.floor(ms / 1000);

// Some systems report locales like "en-US@posix" that Intl rejects, which
// breaks the chart's date labels.
function safeLocale() {
  try {
    new Intl.DateTimeFormat(navigator.language);
    return navigator.language;
  } catch {
    return 'en-US';
  }
}

function initBigChart() {
  if (!window.LightweightCharts || big.api) return;
  big.api = LightweightCharts.createChart($('#bigChart'), {
    autoSize: true,
    localization: { locale: safeLocale() },
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: COLORS.muted, fontSize: 11 },
    grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
    rightPriceScale: { borderColor: COLORS.border },
    timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  big.candles = big.api.addCandlestickSeries({
    upColor: COLORS.up, downColor: COLORS.down, wickUpColor: COLORS.up, wickDownColor: COLORS.down, borderVisible: false,
  });
}

function savedSymbol() {
  try {
    return localStorage.getItem('chartSymbol');
  } catch {
    return null;
  }
}

function renderTabs(signals) {
  const tabs = $('#chartTabs');
  if (!big.symbol) {
    const saved = savedSymbol();
    big.symbol = signals.some((s) => s.symbol === saved) ? saved : signals[0]?.symbol;
  }
  tabs.replaceChildren(
    ...signals.map((s) => {
      const btn = el('button', { class: `tab${s.symbol === big.symbol ? ' active' : ''}`, role: 'tab', title: `${s.signal}` });
      btn.append(el('span', { class: `dot ${s.signal}` }), document.createTextNode(s.symbol.split('/')[0]));
      btn.addEventListener('click', () => selectChart(s.symbol));
      return btn;
    })
  );
}

function selectChart(symbol, scroll = false) {
  big.symbol = symbol;
  try {
    localStorage.setItem('chartSymbol', symbol);
  } catch {
    // Remembering the tab is only a convenience.
  }
  document.querySelectorAll('#chartTabs .tab').forEach((t) => t.classList.toggle('active', t.textContent === symbol.split('/')[0]));
  loadBigChart(true);
  if (scroll) $('.chart-panel').scrollIntoView({ behavior: 'smooth' });
}

async function loadBigChart(fit = false) {
  initBigChart();
  if (!big.api || !big.symbol) return;
  let data;
  try {
    data = await api(`/chart?symbol=${encodeURIComponent(big.symbol)}`);
  } catch {
    return; // appears after the first analysis
  }
  if (data.symbol !== big.symbol) return; // the user switched tabs meanwhile
  big.data = data;
  const range = fit ? null : big.api.timeScale().getVisibleLogicalRange();

  big.candles.setData(data.candles.map(([t, o, h, l, c]) => ({ time: toSec(t), open: o, high: h, low: l, close: c })));
  big.lines.forEach((s) => big.api.removeSeries(s));
  big.lines = data.lines.map((line) => {
    const series = big.api.addLineSeries({
      color: line.color,
      lineWidth: line.style === 'dashed' ? 1 : 2,
      lineStyle: line.style === 'dashed' ? LightweightCharts.LineStyle.Dashed : LightweightCharts.LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    series.setData(line.points.map((p) => ({ time: toSec(p.time), value: p.value })));
    return series;
  });

  const markers = [
    ...data.signals.map((s) => ({
      time: toSec(s.time),
      position: s.signal === 'BUY' ? 'belowBar' : 'aboveBar',
      shape: s.signal === 'BUY' ? 'arrowUp' : 'arrowDown',
      color: s.signal === 'BUY' ? COLORS.up : COLORS.down,
      text: s.signal,
    })),
    ...data.trades.map((t) => ({
      time: toSec(t.time),
      position: t.side === 'buy' ? 'belowBar' : 'aboveBar',
      shape: 'circle',
      color: COLORS.trade,
      text: t.side === 'buy' ? 'bought' : 'sold',
    })),
  ].sort((a, b) => a.time - b.time);
  big.candles.setMarkers(markers);

  big.priceLines.forEach((l) => big.candles.removePriceLine(l));
  big.priceLines = [];
  const p = data.position;
  const level = (price, color, title) =>
    price && big.priceLines.push(big.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title }));
  if (p) {
    level(p.entryPrice, COLORS.trade, 'entry');
    level(p.stopLoss, COLORS.down, p.trailing ? 'trailing stop' : 'stop');
    level(p.takeProfit, COLORS.up, 'target');
  }

  if (range) big.api.timeScale().setVisibleLogicalRange(range);
  else big.api.timeScale().fitContent();
  renderLegend(data);
}

function renderLegend(data) {
  const items = [
    ['▲', COLORS.up, 'BUY signal'],
    ['▼', COLORS.down, 'SELL signal'],
    ['●', COLORS.trade, 'your trade'],
  ].map(([sym, color, text]) => {
    const span = el('span');
    const b = el('b', {}, sym);
    b.style.color = color;
    span.append(b, document.createTextNode(text));
    return span;
  });
  for (const line of data.lines) {
    const span = el('span');
    const swatch = el('i', line.style === 'dashed' ? { class: 'dashed' } : {});
    swatch.style.borderTopColor = line.color;
    span.append(swatch, document.createTextNode(line.name));
    items.push(span);
  }
  items.push(el('span', {}, `${data.timeframe} candles · signals use closed candles`));
  $('#chartLegend').replaceChildren(...items);
}

// Moves the last candle with the live price, so the chart ticks in real time.
function tickBigChart(signals) {
  const d = big.data;
  if (!d || !big.candles) return;
  const s = signals.find((x) => x.symbol === big.symbol);
  const last = d.candles[d.candles.length - 1];
  if (!s?.livePrice || !last || Date.now() >= last[0] + d.tfMs) return; // a new candle arrives with the next analysis
  last[4] = s.livePrice;
  last[2] = Math.max(last[2], s.livePrice);
  last[3] = Math.min(last[3], s.livePrice);
  big.candles.update({ time: toSec(last[0]), open: last[1], high: last[2], low: last[3], close: last[4] });
}

// ------------------------------------------------------------- live data

function applySnapshot(snap) {
  state.lastSnapshotAt = Date.now();
  renderStatus(snap.status);
  renderFeed(snap.priceFeed, true);
  renderSignals(snap.signals);
  renderPortfolio(snap.portfolio);

  const scanChanged = snap.status.lastScanAt !== state.lastScanAt;
  state.lastScanAt = snap.status.lastScanAt;
  renderTabs(snap.signals);
  if (scanChanged || !big.data) loadBigChart(!big.data);
  else tickBigChart(snap.signals);
  for (const s of snap.signals) {
    const candles = state.candles[s.symbol];
    if (scanChanged || !candles) {
      loadCandles(s.symbol);
    } else if (s.livePrice) {
      // Move the chart's last point with the live price.
      const last = candles[candles.length - 1];
      last[4] = s.livePrice;
      drawChart(s.symbol);
    }
  }
}

function renderFeed(feed, connected) {
  state.feed = feed || state.feed;
  state.connected = connected;
  const node = $('#feed');
  if (!connected) {
    node.textContent = 'Reconnecting…';
    node.className = 'feed down';
    return;
  }
  const mode = feed?.mode;
  const age = feed?.lastPriceAt ? Math.round((Date.now() - feed.lastPriceAt) / 1000) : null;
  const stale = age !== null && age > 15;
  let text = mode === 'stream' ? 'LIVE' : mode === 'polling' ? 'LIVE (polling)' : mode === 'error' ? 'Price feed error' : 'Connecting…';
  if (stale) text += ` · no price for ${age}s`;
  node.textContent = text;
  node.className = `feed ${stale || mode === 'error' ? 'down' : mode === 'stream' || mode === 'polling' ? 'up' : ''}`;
  node.title = `${feed?.message || ''}${age !== null ? ` · last price ${age}s ago` : ''}`;
}

async function refresh() {
  try {
    applySnapshot(await api('/snapshot'));
  } catch (err) {
    const banner = $('#banner');
    banner.textContent = `Cannot reach the trading server: ${err.message}`;
    banner.className = 'banner danger';
    renderFeed(null, false);
  }
}

async function loadTrades() {
  renderTrades(await api('/trades').catch(() => []));
}

async function loadAlerts() {
  state.alerts = await api('/alerts').catch(() => state.alerts);
  renderAlerts(state.alerts);
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => {
    loadAlerts();
    loadTrades();
  });
  es.addEventListener('snapshot', (e) => applySnapshot(JSON.parse(e.data)));
  es.addEventListener('alert', (e) => {
    state.alerts.unshift(JSON.parse(e.data));
    state.alerts.length = Math.min(state.alerts.length, 100);
    renderAlerts(state.alerts);
  });
  es.addEventListener('trade', () => {
    loadTrades();
    loadBigChart(); // show the new trade marker and position lines
  });
  es.addEventListener('error', () => renderFeed(null, false)); // EventSource retries on its own
}

connect();
setInterval(() => {
  if (state.feed) renderFeed(state.feed, state.connected);
}, 1000);
// Safety net: if the stream goes quiet (e.g. a proxy buffers it), poll instead.
setInterval(() => {
  if (Date.now() - state.lastSnapshotAt > 8000) refresh();
}, 5000);
window.addEventListener('resize', () => Object.keys(state.cards).forEach(drawChart));
