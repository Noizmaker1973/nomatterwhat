const $ = (sel, el = document) => el.querySelector(sel);
const state = { status: null, cards: {}, lastScanAt: null };

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

async function loadStatus() {
  const s = await api('/status');
  state.status = s;
  const badge = $('#modeBadge');
  badge.textContent = s.mode === 'live' ? 'LIVE TRADING' : 'PAPER';
  badge.className = `badge ${s.mode}`;
  $('#autoTrade').checked = s.autoTrade;
  $('#resetBtn').classList.toggle('hidden', s.mode !== 'paper');
  $('#meta').textContent =
    `${s.exchange} · data: ${s.dataSource} · ${s.timeframe} candles · ` +
    `last scan ${s.lastScanAt ? time(s.lastScanAt) : '—'} (every ${s.scanIntervalSec}s)`;

  const banner = $('#banner');
  const messages = [];
  if (s.mode === 'live') messages.push('LIVE MODE: orders use real money on your exchange account.');
  if (s.liveRequestedButUnconfirmed) messages.push('TRADING_MODE=live is set but CONFIRM_LIVE_TRADING is not "yes" — running in paper mode.');
  if (s.guard?.halted) messages.push(`Daily loss limit reached (${fmt(s.guard.drawdownPct, 2)}% down today). New buys are paused.`);
  const errs = Object.entries(s.errors || {});
  if (errs.length) messages.push(`Data errors: ${errs.map(([sym, e]) => `${sym}: ${e}`).join(' | ')}`);
  if (s.dataSource === 'demo') messages.push('DEMO DATA: prices are synthetic. Set DATA_SOURCE=exchange for real markets.');
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
  $('.sell', node).addEventListener('click', () => order(symbol, 'sell', node));
  $('#signals').appendChild(node);
  state.cards[symbol] = node;
  return node;
}

function renderSignals(signals) {
  for (const s of signals) {
    const card = getCard(s.symbol);
    card.className = `card ${s.signal}`;
    $('.price', card).textContent = s.livePrice ? fmt(s.livePrice) : '…';
    const badge = $('.signal', card);
    badge.textContent = s.signal;
    badge.className = `signal ${s.signal}`;

    const score = s.score || 0;
    const pct = Math.min(Math.abs(score) / 8, 1) * 50;
    const fill = $('.fill', card);
    fill.style.left = score >= 0 ? '50%' : `${50 - pct}%`;
    fill.style.width = `${pct}%`;
    fill.style.background = score >= 0 ? 'var(--buy)' : 'var(--sell)';
    const th = state.status?.strategy || {};
    $('.score-label', card).textContent =
      `Score ${score} (buy ≥ ${th.buyThreshold}, sell ≤ ${th.sellThreshold}) · confidence ${Math.round((s.confidence || 0) * 100)}%`;

    const i = s.indicators || {};
    const stats = $('.stats', card);
    stats.replaceChildren();
    [
      ['RSI', fmt(i.rsi, 1)],
      ['ATR', fmt(i.atr)],
      ['EMA 21', fmt(i.ema21)],
      ['EMA 200', fmt(i.ema200)],
      ['Stop', fmt(s.stopLoss)],
      ['Target', fmt(s.takeProfit)],
    ].forEach(([k, v]) => {
      const row = el('div');
      row.append(el('dt', {}, k), el('dd', {}, v));
      stats.appendChild(row);
    });

    const reasons = $('.reasons', card);
    reasons.replaceChildren(...(s.reasons || []).map((r) => el('li', {}, r)));
  }
}

async function drawChart(symbol) {
  const canvas = $('.chart', getCard(symbol));
  let candles;
  try {
    candles = await api(`/candles?symbol=${encodeURIComponent(symbol)}&limit=120`);
  } catch {
    return;
  }
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
      const span = el('span', { class: 'editable', title: 'Click to change' }, fmt(pos[field]));
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

async function order(symbol, side, card) {
  const live = state.status?.mode === 'live';
  const payload = { symbol, side };
  let description;
  if (side === 'buy') {
    const amount = parseFloat($('.buyAmt', card).value);
    if (amount > 0) payload.quoteAmount = amount;
    description = `BUY ${symbol} for ${amount > 0 ? `${amount} ${state.status.quote}` : 'an auto-sized amount (risk rules)'}`;
  } else {
    payload.percent = Number($('.sellPct', card).value);
    description = `SELL ${payload.percent}% of your ${symbol.split('/')[0]}`;
  }
  if (!confirm(`${live ? '⚠️ LIVE ORDER — real money\n\n' : 'Paper order\n\n'}${description}?`)) return;

  const buttons = card.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await post('/order', payload);
    $('.buyAmt', card).value = '';
    await refresh();
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
    await refresh(true);
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
});

// ------------------------------------------------------------------- loop

async function refresh(forceCharts = false) {
  try {
    const scanChanged = await loadStatus();
    const [signals, portfolio, alerts, trades] = await Promise.all([
      api('/signals'),
      api('/portfolio'),
      api('/alerts'),
      api('/trades'),
    ]);
    renderSignals(signals);
    renderPortfolio(portfolio);
    renderAlerts(alerts);
    renderTrades(trades);
    if (scanChanged || forceCharts) signals.forEach((s) => drawChart(s.symbol));
  } catch (err) {
    const banner = $('#banner');
    banner.textContent = `Cannot reach the trading server: ${err.message}`;
    banner.className = 'banner danger';
  }
}

refresh(true);
setInterval(refresh, 5000);
window.addEventListener('resize', () => Object.keys(state.cards).forEach(drawChart));
