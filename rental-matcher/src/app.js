/* MA Rental Matcher — browser UI. Vanilla JS, no build step. */
(function () {
  'use strict';

  const { geo, csv, schema, matcher, sampleData } = window.RM;
  const STORAGE_KEY = 'rm.workspace.v1';
  const STAGES = ['Shortlisted', 'Sent to client', 'Showing scheduled', 'Application submitted', 'Approved', 'Lease signed', 'Declined'];
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');

  // ---- State & persistence ---------------------------------------------

  let state = load();

  function emptyState() {
    return { units: [], applicants: [], pipeline: [], settings: matcher.mergeSettings() };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return { ...emptyState(), ...s, settings: matcher.mergeSettings(s.settings) };
      }
    } catch (e) { /* storage unavailable or corrupt — start fresh */ }
    return emptyState();
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save to browser storage — export a backup to keep your data.'); }
  }

  // ---- Helpers ---------------------------------------------------------

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (typeof n === 'number' && isFinite(n) ? '$' + Math.round(n).toLocaleString('en-US') : '—');
  const beds = (n) => (n === 0 ? 'Studio' : typeof n === 'number' ? `${n} BR` : '? BR');
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const yn = (b) => (b === true ? 'Yes' : b === false ? 'No' : '—');
  const unitById = (id) => state.units.find((u) => u.id === id);
  const applicantById = (id) => state.applicants.find((a) => a.id === id);
  const unitPlace = (u) => [u.neighborhood, u.town].filter(Boolean).join(', ');
  const unitTitle = (u) => `${beds(u.bedrooms)} · ${u.address || 'Address TBD'}${u.unitNumber ? ' #' + u.unitNumber : ''}`;

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function nextId(prefix, list) {
    let max = 0;
    for (const r of list) {
      const m = String(r.id || '').match(/(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  function download(filename, text, type = 'text/csv') {
    const blob = new Blob([text], { type: type + ';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ---- Routing ---------------------------------------------------------

  function route() {
    const [path, query] = (location.hash.replace(/^#\/?/, '') || 'overview').split('?');
    const params = Object.fromEntries(new URLSearchParams(query || ''));
    return { view: path || 'overview', params };
  }
  function go(view, params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    location.hash = `#/${view}${q}`;
  }

  const VIEWS = { overview: viewOverview, match: viewMatch, applicants: viewApplicants, units: viewUnits, pipeline: viewPipeline, import: viewImport, settings: viewSettings };

  function render() {
    const { view, params } = route();
    const fn = VIEWS[view] || viewOverview;
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    document.getElementById('nav').classList.remove('open');
    app.innerHTML = fn(params);
    if (fn.after) fn.after(params);
  }

  // ---- Shared components -----------------------------------------------

  function badge(status) {
    return `<span class="badge ${status}">${esc(matcher.STATUS_LABELS[status] || status)}</span>`;
  }
  function ring(score, status) {
    const color = { qualified: 'var(--ok)', conditional: 'var(--warn)', not_qualified: 'var(--bad)', not_a_fit: 'var(--muted)' }[status] || 'var(--brand)';
    return `<div class="ring" style="--p:${score};--c:${color}" title="Fit score ${score}/100"><span>${score}</span></div>`;
  }
  function emptyData(what) {
    return `<div class="panel empty">
      <h2>No ${what} yet</h2>
      <p>Import a spreadsheet, add records by hand, or load the sample Massachusetts data to explore.</p>
      <div class="btn-row" style="justify-content:center">
        <a class="btn primary" href="#/import">Import data</a>
        <button class="btn" data-action="load-sample">Load sample data</button>
      </div></div>`;
  }

  const FIT_LABELS = { budget: 'Budget', location: 'Location', timing: 'Timing', size: 'Size', amenities: 'Amenities', lease: 'Lease term', upfront: 'Move-in cost' };

  function matchCard(r, mode) {
    const u = unitById(r.unitId);
    const a = applicantById(r.applicantId);
    const inPipe = state.pipeline.some((p) => p.unitId === r.unitId && p.applicantId === r.applicantId);
    const title = mode === 'applicant'
      ? `<b>${esc(unitTitle(u))}</b><div class="muted">${esc(unitPlace(u))} · ${money(u.rent)}/mo · ${esc(u.landlord || '')} · avail. ${fmtDate(u.availableDate)}</div>`
      : `<b>${esc(a.name || a.id)}</b><div class="muted">Budget ${money(a.maxRent)} · ${beds(a.minBedrooms)}+ · move-in ${fmtDate(a.moveInDate)} · household ${a.householdSize ?? '—'}</div>`;
    const li = (cls, arr) => arr.map((t) => `<li class="${cls}">${esc(t)}</li>`).join('');
    const bars = Object.entries(r.fit).map(([k, f]) => `
      <div class="bar" title="${esc(f.note)}"><span>${FIT_LABELS[k] || k}</span>
        <div class="track"><div class="fill" style="width:${f.max ? Math.round((f.score / f.max) * 100) : 0}%"></div></div>
        <span class="muted">${Math.round(f.score)}/${f.max}</span></div>`).join('');
    const checks = r.checks.map((c) => `<tr><td>${esc(c.check)}</td><td class="res-${c.result}">${esc(c.result)}</td><td>${esc(c.note)}</td></tr>`).join('');
    const cost = r.moveIn ? r.moveIn.items.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${money(i.amount)}</td></tr>`).join('')
      + `<tr><th>Total at signing</th><th class="num">${money(r.moveIn.total)}</th></tr>` : '';
    const warnings = r.compliance.filter((f) => f.level === 'warning');
    return `<div class="match ${r.status}">
      <div class="match-head">${ring(r.score, r.status)}<div class="title">${title}</div>${badge(r.status)}</div>
      <ul class="reasons">${li('no', r.dealbreakers)}${li('good', r.highlights)}${li('meh', r.concerns)}</ul>
      ${warnings.length ? `<div style="margin-top:10px">${warnings.map((f) => `<div class="flag warning">⚠ ${esc(f.message)}</div>`).join('')}</div>` : ''}
      <details class="more"><summary>Details: fit breakdown, screening, move-in cost</summary>
        <div class="detail-grid">
          <div><h3>Fit score</h3>${bars}</div>
          <div><h3>Application screening</h3><table class="small">${checks}</table>
            ${r.tenantPortion !== null && r.tenantPortion !== u.rent ? `<p class="small muted">Tenant share after voucher: ${money(r.tenantPortion)}/mo</p>` : ''}</div>
          <div><h3>Move-in cost</h3><table class="small">${cost}</table></div>
          ${r.compliance.some((f) => f.level === 'info') ? `<div><h3>Notes &amp; compliance</h3>${r.compliance.filter((f) => f.level === 'info').map((f) => `<div class="flag info">${esc(f.message)}</div>`).join('')}</div>` : ''}
        </div>
      </details>
      <div class="btn-row" style="margin-top:10px">
        ${inPipe ? '<span class="badge info">In pipeline</span>' : `<button class="btn sm" data-action="pipe-add" data-a="${esc(r.applicantId)}" data-u="${esc(r.unitId)}">+ Add to pipeline</button>`}
        ${mode === 'applicant'
          ? `<button class="btn sm" data-action="edit-unit" data-id="${esc(u.id)}">View vacancy</button><a class="btn sm" href="#/match?mode=unit&id=${encodeURIComponent(u.id)}">Applicants for this unit →</a>`
          : `<button class="btn sm" data-action="edit-applicant" data-id="${esc(a.id)}">View applicant</button><a class="btn sm" href="#/match?mode=applicant&id=${encodeURIComponent(a.id)}">Units for this applicant →</a>`}
      </div>
    </div>`;
  }

  // ---- Overview --------------------------------------------------------

  function viewOverview() {
    const activeA = state.applicants.filter(matcher.isActiveApplicant);
    const activeU = state.units.filter(matcher.isActiveUnit);
    if (!state.applicants.length && !state.units.length) {
      return `<div class="page-head"><div><h1>Massachusetts rental matchmaking</h1>
        <p class="muted">Import vacancies and applications, then match applicants to units they actually qualify for, or units to qualified applicants.</p></div></div>
        ${emptyData('applicants or vacancies')}`;
    }
    const all = matcher.matchAll(state.applicants, state.units, state.settings);
    const qualified = all.filter((r) => r.status === 'qualified');
    const conditional = all.filter((r) => r.status === 'conditional');
    const flagged = activeU.filter((u) => matcher.unitCompliance(u).some((f) => f.level === 'warning'));
    const countFor = (key, id) => {
      const rows = all.filter((r) => r[key] === id);
      return { q: rows.filter((r) => r.status === 'qualified').length, c: rows.filter((r) => r.status === 'conditional').length };
    };
    const top = [...qualified, ...conditional].slice(0, 12);
    const aRows = activeA.map((a) => ({ a, ...countFor('applicantId', a.id) })).sort((x, y) => (x.q + x.c) - (y.q + y.c));
    const uRows = activeU.map((u) => ({ u, ...countFor('unitId', u.id) })).sort((x, y) => (x.q + x.c) - (y.q + y.c));

    return `<div class="page-head"><div><h1>Overview</h1><p class="muted">Matches across every active applicant and available vacancy.</p></div>
      <div class="btn-row"><button class="btn" data-action="export-all">Export all matches (CSV)</button></div></div>
      <div class="stats">
        <div class="stat"><div class="n">${activeA.length}</div><div class="l">Active applicants</div></div>
        <div class="stat"><div class="n">${activeU.length}</div><div class="l">Available vacancies</div></div>
        <div class="stat"><div class="n" style="color:var(--ok)">${qualified.length}</div><div class="l">Qualified matches</div></div>
        <div class="stat"><div class="n" style="color:var(--warn)">${conditional.length}</div><div class="l">Conditional matches</div></div>
        <div class="stat"><div class="n">${state.pipeline.length}</div><div class="l">In pipeline</div></div>
        <div class="stat"><div class="n" style="color:${flagged.length ? 'var(--bad)' : 'inherit'}">${flagged.length}</div><div class="l">Vacancies with compliance flags</div></div>
      </div>
      <div class="panel"><h2>Best matches</h2>
        ${top.length ? `<div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Vacancy</th><th class="num">Rent</th><th>Status</th><th class="num">Fit</th><th></th></tr></thead><tbody>
        ${top.map((r) => { const a = applicantById(r.applicantId); const u = unitById(r.unitId); return `<tr>
          <td><a href="#/match?mode=applicant&id=${encodeURIComponent(a.id)}">${esc(a.name || a.id)}</a></td>
          <td><a href="#/match?mode=unit&id=${encodeURIComponent(u.id)}">${esc(unitTitle(u))}</a><div class="small muted">${esc(unitPlace(u))}</div></td>
          <td class="num">${money(u.rent)}</td><td>${badge(r.status)}</td><td class="num"><b>${r.score}</b></td>
          <td>${state.pipeline.some((p) => p.unitId === u.id && p.applicantId === a.id) ? '<span class="badge info">In pipeline</span>' : `<button class="btn sm" data-action="pipe-add" data-a="${esc(a.id)}" data-u="${esc(u.id)}">+ Pipeline</button>`}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">No qualified or conditional matches yet. Check budgets, locations and dates, or loosen settings.</p>'}
      </div>
      <div class="grid cols-2">
        <div class="panel"><h2>Applicants by number of options</h2><p class="small muted">Fewest options first — these clients need attention.</p>
          <table><thead><tr><th>Applicant</th><th class="num">Qualified</th><th class="num">Conditional</th></tr></thead><tbody>
          ${aRows.map(({ a, q, c }) => `<tr class="click" data-href="#/match?mode=applicant&id=${encodeURIComponent(a.id)}"><td>${esc(a.name || a.id)}</td><td class="num">${q}</td><td class="num">${c}</td></tr>`).join('')}
          </tbody></table></div>
        <div class="panel"><h2>Vacancies by number of applicants</h2><p class="small muted">Fewest qualified applicants first.</p>
          <table><thead><tr><th>Vacancy</th><th class="num">Qualified</th><th class="num">Conditional</th></tr></thead><tbody>
          ${uRows.map(({ u, q, c }) => `<tr class="click" data-href="#/match?mode=unit&id=${encodeURIComponent(u.id)}"><td>${esc(unitTitle(u))}<div class="small muted">${esc(unitPlace(u))}</div></td><td class="num">${q}</td><td class="num">${c}</td></tr>`).join('')}
          </tbody></table></div>
      </div>
      ${flagged.length ? `<div class="panel"><h2>Compliance flags</h2>${flagged.map((u) => `<div style="margin-bottom:10px"><b>${esc(u.id)} · ${esc(unitTitle(u))}</b> <span class="muted">${esc(unitPlace(u))}</span>
        ${matcher.unitCompliance(u).filter((f) => f.level === 'warning').map((f) => `<div class="flag warning">${esc(f.message)}</div>`).join('')}</div>`).join('')}</div>` : ''}`;
  }

  // ---- Match -----------------------------------------------------------

  let matchFilters = { showNotFit: false, minScore: 0, hideNotQualified: false };

  function viewMatch(params) {
    const mode = params.mode === 'unit' ? 'unit' : 'applicant';
    const pool = mode === 'applicant' ? state.applicants : state.units;
    if (!pool.length) return `<div class="page-head"><h1>Match</h1></div>${emptyData(mode === 'applicant' ? 'applicants' : 'vacancies')}`;
    const sorted = [...pool].sort((x, y) => {
      const ax = mode === 'applicant' ? matcher.isActiveApplicant(x) : matcher.isActiveUnit(x);
      const ay = mode === 'applicant' ? matcher.isActiveApplicant(y) : matcher.isActiveUnit(y);
      return (ay - ax) || String(x.id).localeCompare(String(y.id));
    });
    const id = params.id && pool.some((r) => r.id === params.id) ? params.id : sorted[0].id;
    const subject = mode === 'applicant' ? applicantById(id) : unitById(id);
    const results = mode === 'applicant'
      ? matcher.matchApplicant(subject, state.units, state.settings)
      : matcher.matchUnit(subject, state.applicants, state.settings);
    const shown = results.filter((r) => (matchFilters.showNotFit || r.status !== 'not_a_fit')
      && (!matchFilters.hideNotQualified || r.status !== 'not_qualified')
      && r.score >= matchFilters.minScore);
    const counts = Object.fromEntries(Object.keys(matcher.STATUS_LABELS).map((s) => [s, results.filter((r) => r.status === s).length]));
    const label = (r) => mode === 'applicant'
      ? `${r.id} · ${r.name || ''}${matcher.isActiveApplicant(r) ? '' : ` (${r.status})`}`
      : `${r.id} · ${unitTitle(r)} · ${unitPlace(r)} · ${money(r.rent)}${matcher.isActiveUnit(r) ? '' : ` (${r.status})`}`;

    const summary = mode === 'applicant' ? applicantSummary(subject) : unitSummary(subject);
    const inactive = mode === 'applicant' ? !matcher.isActiveApplicant(subject) : !matcher.isActiveUnit(subject);
    const pending = results.length - shown.length;
    return `<div class="page-head"><div><h1>Match</h1><p class="muted">${mode === 'applicant' ? 'Find qualified vacancies for an applicant.' : 'Find qualified applicants for a vacancy.'}</p></div>
        <div class="seg"><button data-action="match-mode" data-mode="applicant" class="${mode === 'applicant' ? 'on' : ''}">Applicant → Vacancies</button><button data-action="match-mode" data-mode="unit" class="${mode === 'unit' ? 'on' : ''}">Vacancy → Applicants</button></div></div>
      <div class="panel">
        <div class="toolbar">
          <select id="matchSubject" class="grow">${sorted.map((r) => `<option value="${esc(r.id)}" ${r.id === id ? 'selected' : ''}>${esc(label(r))}</option>`).join('')}</select>
          <button class="btn" data-action="${mode === 'applicant' ? 'edit-applicant' : 'edit-unit'}" data-id="${esc(id)}">Edit</button>
        </div>
        ${summary}
        ${inactive ? `<div class="flag info">This ${mode === 'applicant' ? 'applicant is marked ' + esc(subject.status) : 'vacancy is marked ' + esc(subject.status)} and is excluded from the Overview.</div>` : ''}
      </div>
      <div class="toolbar">
        <span>${badge('qualified')} ${counts.qualified} &nbsp; ${badge('conditional')} ${counts.conditional} &nbsp; ${badge('not_qualified')} ${counts.not_qualified} &nbsp; ${badge('not_a_fit')} ${counts.not_a_fit}</span>
        <span class="grow"></span>
        <label class="check"><input type="checkbox" id="fNotFit" ${matchFilters.showNotFit ? 'checked' : ''}> Show “not a fit”</label>
        <label class="check"><input type="checkbox" id="fNotQ" ${matchFilters.hideNotQualified ? 'checked' : ''}> Hide “not qualified”</label>
        <label class="check">Min fit <input type="number" id="fMin" min="0" max="100" step="5" value="${matchFilters.minScore}" style="width:70px"></label>
        <button class="btn" data-action="export-match" data-mode="${mode}" data-id="${esc(id)}">Export CSV</button>
      </div>
      ${shown.length ? shown.map((r) => matchCard(r, mode)).join('') : `<div class="panel empty">No ${mode === 'applicant' ? 'vacancies' : 'applicants'} pass the current filters.${pending ? ` ${pending} hidden — tick “Show not a fit” to see why.` : ''}</div>`}`;
  }
  viewMatch.after = (params) => {
    const mode = params.mode === 'unit' ? 'unit' : 'applicant';
    const sel = document.getElementById('matchSubject');
    if (sel) sel.onchange = () => go('match', { mode, id: sel.value });
    const bind = (elId, fn) => { const el = document.getElementById(elId); if (el) el.onchange = () => { fn(el); render(); }; };
    bind('fNotFit', (el) => { matchFilters.showNotFit = el.checked; });
    bind('fNotQ', (el) => { matchFilters.hideNotQualified = el.checked; });
    bind('fMin', (el) => { matchFilters.minScore = Math.max(0, Math.min(100, Number(el.value) || 0)); });
  };

  function applicantSummary(a) {
    const chips = (arr) => (arr || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">—</span>';
    return `<div class="form-grid small">
      <div><b>Budget</b><br>${money(a.maxRent)}/mo${a.hasVoucher ? ` <span class="badge info">Voucher ${money(a.voucherAmount)}</span>` : ''}</div>
      <div><b>Size</b><br>${beds(a.minBedrooms)}+ · ${a.minBathrooms ?? '—'} bath · household ${a.householdSize ?? '—'}</div>
      <div><b>Move-in</b><br>${fmtDate(a.moveInDate)} (±${a.moveInFlexDays ?? state.settings.defaultFlexDays}d)</div>
      <div><b>Income / credit</b><br>${money(a.annualIncome)}/yr · ${a.creditScore ?? '—'}${a.hasCosigner ? ' · co-signer' : ''}</div>
      <div><b>Locations</b><br>${chips(a.locations)}</div>
      <div><b>Must-haves</b><br>${chips(a.mustHaves)}</div>
      <div><b>Nice-to-haves</b><br>${chips(a.niceToHaves)}</div>
      <div><b>Pets</b><br>${chips(a.pets)}${a.assistanceAnimal ? ' <span class="badge info">Assistance animal</span>' : ''}</div>
    </div>`;
  }
  function unitSummary(u) {
    const chips = (arr) => (arr || []).map((x) => `<span class="chip">${esc(x)}</span>`).join('') || '<span class="muted">—</span>';
    return `<div class="form-grid small">
      <div><b>Rent</b><br>${money(u.rent)}/mo · ${esc(u.region || '')}</div>
      <div><b>Size</b><br>${beds(u.bedrooms)} · ${u.bathrooms ?? '—'} bath${u.sqft ? ` · ${u.sqft} sf` : ''}</div>
      <div><b>Available</b><br>${fmtDate(u.availableDate)} · ${u.leaseTermMonths ?? '—'}-mo lease</div>
      <div><b>Screening</b><br>${u.incomeMultiple ? u.incomeMultiple + '× income' : 'No income req.'} · ${u.minCreditScore ? u.minCreditScore + '+ credit' : 'no credit min'} · co-signer ${yn(u.allowsCosigner)}</div>
      <div><b>Upfront</b><br>Last ${yn(u.lastMonthRequired)} · deposit ${money(u.securityDeposit)}${u.brokerFee ? ` · fee ${money(u.brokerFee)}` : ''}</div>
      <div><b>Pets</b><br>${chips(u.petPolicy)}</div>
      <div><b>Amenities</b><br>${chips(u.amenities)}</div>
      <div><b>Landlord</b><br>${esc(u.landlord || '—')}<br><span class="muted">${esc(u.contact || '')}</span></div>
    </div>`;
  }

  function matchesToCSV(results) {
    const rows = results.map((r) => {
      const a = applicantById(r.applicantId); const u = unitById(r.unitId);
      return {
        applicantId: a.id, applicant: a.name, unitId: u.id, address: `${u.address || ''}${u.unitNumber ? ' #' + u.unitNumber : ''}`,
        town: unitPlace(u), rent: u.rent, bedrooms: u.bedrooms, landlord: u.landlord, contact: u.contact,
        status: r.statusLabel, score: r.score, tenantShare: r.tenantPortion, moveInCost: r.moveIn ? r.moveIn.total : '',
        dealbreakers: r.dealbreakers.join('; '), highlights: r.highlights.join('; '), concerns: r.concerns.join('; '),
        screening: r.checks.map((c) => `${c.check}: ${c.result} (${c.note})`).join('; '),
        compliance: r.compliance.map((f) => f.message).join(' | '),
      };
    });
    return csv.stringify(rows, [
      { key: 'applicantId', label: 'Applicant ID' }, { key: 'applicant', label: 'Applicant' }, { key: 'unitId', label: 'Unit ID' },
      { key: 'address', label: 'Address' }, { key: 'town', label: 'Town' }, { key: 'rent', label: 'Rent' }, { key: 'bedrooms', label: 'Bedrooms' },
      { key: 'landlord', label: 'Landlord' }, { key: 'contact', label: 'Landlord contact' }, { key: 'status', label: 'Match status' },
      { key: 'score', label: 'Fit score' }, { key: 'tenantShare', label: 'Tenant share of rent' }, { key: 'moveInCost', label: 'Due at signing' },
      { key: 'dealbreakers', label: 'Dealbreakers' }, { key: 'highlights', label: 'Highlights' }, { key: 'concerns', label: 'Concerns' },
      { key: 'screening', label: 'Screening' }, { key: 'compliance', label: 'Compliance notes' },
    ]);
  }

  // ---- Applicants & units lists ---------------------------------------

  let listSearch = { applicants: '', units: '' };

  function viewApplicants() {
    if (!state.applicants.length) return `<div class="page-head"><h1>Applicants</h1><button class="btn primary" data-action="new-applicant">+ Add applicant</button></div>${emptyData('applicants')}`;
    const q = listSearch.applicants.toLowerCase();
    const rows = state.applicants.filter((a) => !q || JSON.stringify(a).toLowerCase().includes(q));
    return `<div class="page-head"><div><h1>Applicants</h1><p class="muted">${state.applicants.length} total · click a row to edit</p></div>
      <div class="btn-row"><button class="btn primary" data-action="new-applicant">+ Add applicant</button><a class="btn" href="#/import?kind=applicant">Import</a><button class="btn" data-action="export-records" data-kind="applicant">Export CSV</button></div></div>
      <div class="panel"><div class="toolbar"><input id="listSearch" class="grow" placeholder="Search applicants…" value="${esc(listSearch.applicants)}"></div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Name</th><th>Status</th><th class="num">Budget</th><th>Beds</th><th>Locations</th><th>Move-in</th><th class="num">Income</th><th class="num">Credit</th><th>Voucher</th><th></th></tr></thead><tbody>
      ${rows.map((a) => `<tr class="click" data-action="edit-applicant" data-id="${esc(a.id)}">
        <td>${esc(a.id)}</td><td><b>${esc(a.name)}</b><div class="small muted">${esc(a.email || a.phone || '')}</div></td><td><span class="badge ${a.status === 'active' ? 'qualified' : 'gray'}">${esc(a.status)}</span></td>
        <td class="num">${money(a.maxRent)}</td><td>${beds(a.minBedrooms)}+</td><td>${(a.locations || []).map((l) => `<span class="chip">${esc(l)}</span>`).join('')}</td>
        <td>${fmtDate(a.moveInDate)}</td><td class="num">${money(a.annualIncome)}</td><td class="num">${a.creditScore ?? '—'}</td><td>${a.hasVoucher ? money(a.voucherAmount) : '—'}</td>
        <td><a class="btn sm" href="#/match?mode=applicant&id=${encodeURIComponent(a.id)}" data-stop>Matches</a></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  viewApplicants.after = () => bindSearch('applicants');

  function viewUnits() {
    if (!state.units.length) return `<div class="page-head"><h1>Vacancies</h1><button class="btn primary" data-action="new-unit">+ Add vacancy</button></div>${emptyData('vacancies')}`;
    const q = listSearch.units.toLowerCase();
    const rows = state.units.filter((u) => !q || JSON.stringify(u).toLowerCase().includes(q));
    return `<div class="page-head"><div><h1>Vacancies</h1><p class="muted">${state.units.length} total · click a row to edit</p></div>
      <div class="btn-row"><button class="btn primary" data-action="new-unit">+ Add vacancy</button><a class="btn" href="#/import?kind=unit">Import</a><button class="btn" data-action="export-records" data-kind="unit">Export CSV</button></div></div>
      <div class="panel"><div class="toolbar"><input id="listSearch" class="grow" placeholder="Search vacancies…" value="${esc(listSearch.units)}"></div>
      <div class="table-wrap"><table><thead><tr><th>ID</th><th>Unit</th><th>Location</th><th>Status</th><th class="num">Rent</th><th>Available</th><th>Screening</th><th>Flags</th><th></th></tr></thead><tbody>
      ${rows.map((u) => { const flags = matcher.unitCompliance(u).filter((f) => f.level === 'warning'); return `<tr class="click" data-action="edit-unit" data-id="${esc(u.id)}">
        <td>${esc(u.id)}</td><td><b>${esc(unitTitle(u))}</b><div class="small muted">${esc(u.landlord || '')}</div></td><td>${esc(unitPlace(u))}<div class="small muted">${esc(u.region)}</div></td>
        <td><span class="badge ${u.status === 'available' ? 'qualified' : 'gray'}">${esc(u.status)}</span></td><td class="num">${money(u.rent)}</td><td>${fmtDate(u.availableDate)}</td>
        <td class="small">${u.incomeMultiple ? u.incomeMultiple + '× income' : '—'}<br>${u.minCreditScore ? u.minCreditScore + '+ credit' : ''}</td>
        <td>${flags.length ? `<span class="badge not_qualified" title="${esc(flags.map((f) => f.message).join('\n'))}">${flags.length} flag${flags.length > 1 ? 's' : ''}</span>` : ''}</td>
        <td><a class="btn sm" href="#/match?mode=unit&id=${encodeURIComponent(u.id)}" data-stop>Matches</a></td></tr>`; }).join('')}
      </tbody></table></div></div>`;
  }
  viewUnits.after = () => bindSearch('units');

  function bindSearch(which) {
    const el = document.getElementById('listSearch');
    if (!el) return;
    el.oninput = () => {
      listSearch[which] = el.value;
      const pos = el.selectionStart;
      render();
      const again = document.getElementById('listSearch');
      again.focus();
      again.setSelectionRange(pos, pos);
    };
  }

  // ---- Record editor (modal) ------------------------------------------

  function fieldInput(f, value) {
    const id = `f_${f.key}`;
    let input;
    if (f.type === 'bool') {
      input = `<select id="${id}" name="${f.key}"><option value="">Unknown</option><option value="yes" ${value === true ? 'selected' : ''}>Yes</option><option value="no" ${value === false ? 'selected' : ''}>No</option></select>`;
    } else if (f.type === 'enum') {
      input = `<select id="${id}" name="${f.key}">${f.options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'date') {
      input = `<input type="date" id="${id}" name="${f.key}" value="${esc(value || '')}">`;
    } else if (f.type === 'text') {
      input = `<textarea id="${id}" name="${f.key}">${esc(value || '')}</textarea>`;
    } else if (f.type === 'list') {
      input = `<input id="${id}" name="${f.key}" value="${esc((value || []).join('; '))}" placeholder="separate with ;">`;
    } else if (['money', 'number', 'beds', 'multiple'].includes(f.type)) {
      input = `<input id="${id}" name="${f.key}" inputmode="decimal" value="${value ?? ''}">`;
    } else {
      input = `<input id="${id}" name="${f.key}" value="${esc(value ?? '')}">`;
    }
    return `<label class="field" ${f.type === 'text' ? 'style="grid-column:1/-1"' : ''}><span>${esc(f.label)}</span>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</label>`;
  }

  function openEditor(kind, id) {
    const list = kind === 'unit' ? state.units : state.applicants;
    const existing = id ? list.find((r) => r.id === id) : null;
    const rec = existing || schema.finalize({ id: nextId(kind === 'unit' ? 'U' : 'A', list) }, kind);
    const fields = schema.fieldsFor(kind).filter((f) => !f.importOnly);
    const extra = rec.extra ? Object.entries(rec.extra) : [];
    const flags = kind === 'unit' && existing ? matcher.unitCompliance(rec) : [];
    modal.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-head"><h2>${existing ? 'Edit' : 'New'} ${kind === 'unit' ? 'vacancy' : 'applicant'}</h2><button class="btn sm" data-action="close-modal">✕</button></div>
      ${flags.map((f) => `<div class="flag ${f.level}">${esc(f.message)}</div>`).join('')}
      ${kind === 'applicant' ? '<p class="small muted">Do not record race, religion, national origin, disability, sex, sexual orientation, gender identity, age, marital status, veteran status, genetic information or similar protected characteristics. Only the fields below are used for matching.</p>' : ''}
      <form id="editForm"><div class="form-grid">${fields.map((f) => fieldInput(f, rec[f.key])).join('')}</div>
      ${extra.length ? `<h3 style="margin-top:14px">Other imported columns</h3><div class="small">${extra.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}</div>` : ''}
      <div class="btn-row" style="margin-top:16px">
        <button type="submit" class="btn primary">Save</button>
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <span style="flex:1"></span>
        ${existing ? `<button type="button" class="btn danger" data-action="delete-record" data-kind="${kind}" data-id="${esc(rec.id)}">Delete</button>` : ''}
      </div></form></div>`;
    modal.hidden = false;
    document.getElementById('editForm').onsubmit = (e) => {
      e.preventDefault();
      const raw = Object.fromEntries(new FormData(e.target).entries());
      const updated = schema.normalizeRecord(raw, kind, null);
      if (rec.extra) updated.extra = rec.extra;
      if (!updated.id) updated.id = rec.id;
      const clash = list.find((r) => r.id === updated.id && r !== existing);
      if (clash) { toast(`ID ${updated.id} is already in use.`); return; }
      if (existing) {
        Object.keys(existing).forEach((k) => delete existing[k]);
        Object.assign(existing, updated);
        if (existing.id !== id) state.pipeline.forEach((p) => {
          if (kind === 'unit' && p.unitId === id) p.unitId = existing.id;
          if (kind === 'applicant' && p.applicantId === id) p.applicantId = existing.id;
        });
      } else list.push(updated);
      save();
      closeModal();
      toast('Saved');
      render();
    };
  }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; }

  // ---- Pipeline --------------------------------------------------------

  function viewPipeline() {
    const rows = state.pipeline.map((p) => {
      const a = applicantById(p.applicantId); const u = unitById(p.unitId);
      return { p, a, u, r: a && u ? matcher.evaluate(a, u, state.settings) : null };
    });
    return `<div class="page-head"><div><h1>Pipeline</h1><p class="muted">Track shortlisted pairings from introduction to signed lease. Status and fit are recalculated live.</p></div>
      ${rows.length ? '<button class="btn" data-action="export-pipeline">Export CSV</button>' : ''}</div>
      ${rows.length ? `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Vacancy</th><th>Match</th><th>Stage</th><th>Notes</th><th></th></tr></thead><tbody>
      ${rows.map(({ p, a, u, r }, i) => `<tr>
        <td>${a ? `<a href="#/match?mode=applicant&id=${encodeURIComponent(a.id)}">${esc(a.name || a.id)}</a>` : `<span class="muted">${esc(p.applicantId)} (deleted)</span>`}</td>
        <td>${u ? `<a href="#/match?mode=unit&id=${encodeURIComponent(u.id)}">${esc(unitTitle(u))}</a><div class="small muted">${esc(unitPlace(u))} · ${money(u.rent)}</div>` : `<span class="muted">${esc(p.unitId)} (deleted)</span>`}</td>
        <td>${r ? `${badge(r.status)} <b>${r.score}</b>` : '—'}</td>
        <td><select data-pipe-stage="${i}">${STAGES.map((s) => `<option ${s === p.stage ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="small muted">Updated ${fmtDate(p.updated)}</div></td>
        <td><input data-pipe-notes="${i}" value="${esc(p.notes || '')}" placeholder="Add note…"></td>
        <td><button class="btn sm danger" data-action="pipe-remove" data-i="${i}">Remove</button></td></tr>`).join('')}
      </tbody></table></div></div>` : '<div class="panel empty">Nothing in the pipeline yet. Use “+ Add to pipeline” on any match.</div>'}`;
  }
  viewPipeline.after = () => {
    app.querySelectorAll('[data-pipe-stage]').forEach((el) => { el.onchange = () => { const p = state.pipeline[+el.dataset.pipeStage]; p.stage = el.value; p.updated = schema.todayISO(); save(); render(); }; });
    app.querySelectorAll('[data-pipe-notes]').forEach((el) => { el.onchange = () => { const p = state.pipeline[+el.dataset.pipeNotes]; p.notes = el.value; p.updated = schema.todayISO(); save(); }; });
  };

  // ---- Import / export -------------------------------------------------

  let pendingImport = null; // {kind, headers, records, mapping, fileName}

  function viewImport(params) {
    const kind = params.kind === 'applicant' ? 'applicant' : 'unit';
    if (pendingImport) return importMappingView();
    return `<div class="page-head"><div><h1>Import / Export</h1><p class="muted">Bring in landlord vacancy lists and rental applications from any spreadsheet (CSV, TSV or JSON). Columns are matched automatically and you can adjust the mapping before importing.</p></div></div>
      <div class="grid cols-2">
        <div class="panel"><h2>Import</h2>
          <div class="toolbar"><div class="seg"><button data-action="import-kind" data-kind="unit" class="${kind === 'unit' ? 'on' : ''}">Vacancies / landlord data</button><button data-action="import-kind" data-kind="applicant" class="${kind === 'applicant' ? 'on' : ''}">Applicants / applications</button></div></div>
          <div class="dropzone" id="dropzone"><p><b>Drop a .csv, .tsv or .json file here</b></p><p class="muted small">Export from Excel or Google Sheets as CSV, or export from your CRM/MLS.</p>
            <input type="file" id="fileInput" accept=".csv,.tsv,.txt,.json" style="max-width:280px"></div>
          <p class="small muted" style="margin-top:12px">…or paste spreadsheet rows (with a header row):</p>
          <textarea id="pasteInput" placeholder="Paste rows copied from Excel/Sheets here"></textarea>
          <div class="btn-row" style="margin-top:8px"><button class="btn" data-action="parse-paste" data-kind="${kind}">Continue with pasted data</button></div>
        </div>
        <div class="panel"><h2>Templates &amp; samples</h2>
          <p>Start from a blank template with every supported column, or download the sample files to see the format.</p>
          <div class="btn-row" style="margin-bottom:14px">
            <button class="btn" data-action="template" data-kind="unit">Vacancy template</button>
            <button class="btn" data-action="template" data-kind="applicant">Applicant template</button>
            <button class="btn" data-action="sample-file" data-kind="unit">Sample vacancies</button>
            <button class="btn" data-action="sample-file" data-kind="applicant">Sample applicants</button>
          </div>
          <button class="btn primary" data-action="load-sample">Load sample data into workspace</button>
          <h2 style="margin-top:22px">Backup</h2>
          <p class="small muted">Everything is stored in this browser only. Export a backup to move data to another computer or keep a copy.</p>
          <div class="btn-row">
            <button class="btn" data-action="backup">Export backup (.json)</button>
            <label class="btn">Restore backup<input type="file" id="restoreInput" accept=".json" hidden></label>
            <button class="btn danger" data-action="clear-all">Clear all data</button>
          </div>
        </div>
      </div>`;
  }
  viewImport.after = (params) => {
    if (pendingImport) return bindMapping();
    const kind = params.kind === 'applicant' ? 'applicant' : 'unit';
    const fileInput = document.getElementById('fileInput');
    const dz = document.getElementById('dropzone');
    const readFile = (file) => file.text().then((text) => beginImport(kind, text, file.name));
    fileInput.onchange = () => fileInput.files[0] && readFile(fileInput.files[0]);
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    document.getElementById('restoreInput').onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => {
        try {
          const data = JSON.parse(t);
          if (!Array.isArray(data.units) || !Array.isArray(data.applicants)) throw new Error('bad');
          if (!confirm('Replace the current workspace with this backup?')) return;
          state = { ...emptyState(), ...data, settings: matcher.mergeSettings(data.settings) };
          save(); toast('Backup restored'); go('overview');
        } catch (err) { toast('That file is not a valid backup.'); }
      });
    };
  };

  function beginImport(kind, text, fileName) {
    let headers; let records;
    const trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        let data = JSON.parse(trimmed);
        if (!Array.isArray(data)) data = data[kind === 'unit' ? 'units' : 'applicants'] || data.records || data.data || [];
        records = data.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.join('; ') : v ?? ''])));
        headers = [...new Set(records.flatMap((r) => Object.keys(r)))];
      } catch (e) { toast('Could not read JSON file.'); return; }
    } else {
      ({ headers, records } = csv.parse(text));
    }
    if (!records.length) { toast('No rows found. Make sure the first row has column names.'); return; }
    pendingImport = { kind, headers, records, mapping: schema.autoMapHeaders(headers, kind), fileName, mode: 'merge' };
    render();
  }

  function importMappingView() {
    const { kind, headers, records, mapping, fileName, mode } = pendingImport;
    const fields = schema.fieldsFor(kind);
    const mapped = Object.values(mapping).filter(Boolean).length;
    const preview = records.slice(0, 50).map((r) => schema.normalizeRecord(r, kind, mapping));
    const required = kind === 'unit' ? ['rent', 'town', 'bedrooms'] : ['name', 'maxRent', 'minBedrooms'];
    const missing = required.filter((k) => !Object.values(mapping).includes(k));
    return `<div class="page-head"><div><h1>Map columns</h1><p class="muted">${esc(fileName || 'Pasted data')} · ${records.length} ${kind === 'unit' ? 'vacancies' : 'applicants'} · ${mapped}/${headers.length} columns recognized</p></div></div>
      <div class="panel">
        ${missing.length ? `<div class="flag warning">Not mapped yet: ${missing.map((k) => esc(fields.find((f) => f.key === k).label)).join(', ')}. Matching works best with these.</div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Your column</th><th>Example value</th><th>Maps to</th></tr></thead><tbody>
        ${headers.map((h) => `<tr><td><b>${esc(h)}</b></td><td class="muted small">${esc(String(records.find((r) => r[h])?.[h] ?? '').slice(0, 60))}</td>
          <td><select data-map="${esc(h)}"><option value="">— Keep as extra info —</option>${fields.map((f) => `<option value="${f.key}" ${mapping[h] === f.key ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>
        <div class="toolbar" style="margin-top:14px">
          <label class="check"><input type="radio" name="importMode" value="merge" ${mode === 'merge' ? 'checked' : ''}> Merge — update matching IDs, add new rows</label>
          <label class="check"><input type="radio" name="importMode" value="replace" ${mode === 'replace' ? 'checked' : ''}> Replace all existing ${kind === 'unit' ? 'vacancies' : 'applicants'}</label>
        </div>
        <div class="btn-row"><button class="btn primary" data-action="do-import">Import ${records.length} rows</button><button class="btn" data-action="cancel-import">Cancel</button></div>
      </div>
      <div class="panel"><h2>Preview</h2><div class="table-wrap"><table class="small"><thead><tr>${kind === 'unit'
        ? '<th>ID</th><th>Address</th><th>Town</th><th>Region</th><th class="num">Rent</th><th>Beds</th><th>Available</th><th>Income req.</th><th>Credit min</th>'
        : '<th>ID</th><th>Name</th><th class="num">Budget</th><th>Beds</th><th>Locations</th><th>Move-in</th><th class="num">Income</th><th>Credit</th><th>Voucher</th>'}</tr></thead><tbody>
        ${preview.slice(0, 10).map((r) => kind === 'unit'
          ? `<tr><td>${esc(r.id || '(new)')}</td><td>${esc(r.address)}</td><td>${esc(unitPlace(r))}</td><td>${esc(r.region)}</td><td class="num">${money(r.rent)}</td><td>${beds(r.bedrooms)}</td><td>${fmtDate(r.availableDate)}</td><td>${r.incomeMultiple ?? '—'}</td><td>${r.minCreditScore ?? '—'}</td></tr>`
          : `<tr><td>${esc(r.id || '(new)')}</td><td>${esc(r.name)}</td><td class="num">${money(r.maxRent)}</td><td>${beds(r.minBedrooms)}</td><td>${esc((r.locations || []).join('; '))}</td><td>${fmtDate(r.moveInDate)}</td><td class="num">${money(r.annualIncome)}</td><td>${r.creditScore ?? '—'}</td><td>${yn(r.hasVoucher)}</td></tr>`).join('')}
      </tbody></table></div>${records.length > 10 ? `<p class="small muted">Showing 10 of ${records.length}.</p>` : ''}</div>`;
  }
  function bindMapping() {
    app.querySelectorAll('[data-map]').forEach((sel) => {
      sel.onchange = () => {
        const h = sel.dataset.map;
        const v = sel.value || null;
        if (v) for (const k of Object.keys(pendingImport.mapping)) if (pendingImport.mapping[k] === v) pendingImport.mapping[k] = null;
        pendingImport.mapping[h] = v;
        render();
      };
    });
    app.querySelectorAll('input[name=importMode]').forEach((r) => { r.onchange = () => { pendingImport.mode = r.value; }; });
  }

  function commitImport() {
    const { kind, records, mapping, mode } = pendingImport;
    const key = kind === 'unit' ? 'units' : 'applicants';
    const prefix = kind === 'unit' ? 'U' : 'A';
    let list = mode === 'replace' ? [] : [...state[key]];
    let added = 0; let updated = 0;
    for (const raw of records) {
      const rec = schema.normalizeRecord(raw, kind, mapping);
      const i = rec.id ? list.findIndex((r) => r.id === rec.id) : -1;
      if (i >= 0) { list[i] = rec; updated++; } else {
        if (!rec.id) rec.id = nextId(prefix, list);
        list.push(rec); added++;
      }
    }
    state[key] = list;
    save();
    pendingImport = null;
    toast(`Imported ${added} new${updated ? `, updated ${updated}` : ''} ${kind === 'unit' ? 'vacancies' : 'applicants'}`);
    go(kind === 'unit' ? 'units' : 'applicants');
  }

  function loadSample() {
    if ((state.units.length || state.applicants.length) && !confirm('Replace your current vacancies and applicants with the sample data?')) return;
    const loadCSV = (text, kind) => {
      const { headers, records } = csv.parse(text);
      const map = schema.autoMapHeaders(headers, kind);
      return records.map((r) => schema.normalizeRecord(r, kind, map));
    };
    state.units = loadCSV(sampleData.units, 'unit');
    state.applicants = loadCSV(sampleData.applicants, 'applicant');
    state.pipeline = [];
    save();
    toast('Sample data loaded: 14 vacancies, 8 applicants');
    go('overview');
    render();
  }

  // ---- Settings --------------------------------------------------------

  function viewSettings() {
    const s = state.settings;
    const w = s.weights;
    const num = (id, label, value, hint, attrs = '') => `<label class="field"><span>${label}</span><input type="number" id="${id}" value="${value}" ${attrs}><div class="hint">${hint}</div></label>`;
    return `<div class="page-head"><div><h1>Settings</h1><p class="muted">Tune how strict the matching is and what matters most in the fit score.</p></div></div>
      <div class="panel"><h2>Matching rules</h2><div class="form-grid">
        ${num('sTol', 'Over-budget tolerance (%)', s.rentTolerancePct, 'Units up to this % over budget are still shown, with a penalty.', 'min="0" max="50"')}
        ${num('sFlex', 'Default move-in flexibility (days)', s.defaultFlexDays, 'Used when an applicant has no flexibility set.', 'min="0" max="180"')}
        ${num('sEarly', 'Early-vacancy window (days)', s.earlyAvailabilityDays, 'A unit vacant longer than this before move-in gets a timing penalty.', 'min="0" max="180"')}
        <label class="field"><span>Location</span><label class="check"><input type="checkbox" id="sStrict" ${s.strictLocation ? 'checked' : ''}> Units outside every preferred region are “not a fit”</label>
          <div class="hint">Untick to rank them low instead.</div></label>
      </div></div>
      <div class="panel"><h2>Fit-score weights</h2><p class="small muted">Relative importance. The score is normalized to 0–100 whatever the total.</p><div class="form-grid">
        ${Object.entries(w).map(([k, v]) => num('w_' + k, FIT_LABELS[k] || k, v, '', 'min="0" max="100"')).join('')}
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn primary" data-action="save-settings">Save settings</button><button class="btn" data-action="reset-settings">Reset to defaults</button></div></div>
      <div class="panel"><h2>How matching works</h2>
        <ol>
          <li><b>Dealbreakers</b>: rent over budget (beyond tolerance), too few bedrooms, outside preferred areas, availability after the move-in window, pets not allowed, a missing must-have, or a household over the occupancy limit. Any one makes the pair <span class="badge not_a_fit">Not a fit</span>.</li>
          <li><b>Application screening</b> against the landlord's criteria: income multiple, minimum credit, eviction policy and cash due at signing. Co-signers count where the landlord accepts them. Result: <span class="badge qualified">Qualified</span>, <span class="badge conditional">Conditional</span> (borderline, co-signer needed or data missing) or <span class="badge not_qualified">Not qualified</span>.</li>
          <li><b>Fit score</b> (0–100) ranks how well the unit fits what the client wants: budget, location, timing, size, amenities, lease term and move-in cost.</li>
        </ol>
        <h3>Massachusetts rules built in</h3>
        <ul>
          <li><b>Vouchers / source of income</b> (M.G.L. c.151B §4(10)): voucher holders are always matched, even to units marked “no Section 8”, which are flagged. Income tests use only the tenant's share of rent after the subsidy.</li>
          <li><b>Upfront costs</b> (M.G.L. c.186 §15B): application fees and security deposits over one month's rent are flagged. Move-in cost totals first month, last month, deposit and any tenant-paid broker fee.</li>
          <li><b>Broker fees</b>: since Aug 1, 2025, the party who hires the broker pays. Tenant-paid fees are flagged for review.</li>
          <li><b>Lead Law</b> (M.G.L. c.111 §199A): households with a child under 6 are never excluded from pre-1978 units. A flag reminds you the owner must delead.</li>
          <li><b>Assistance animals</b> are not pets and are never a dealbreaker.</li>
          <li><b>Protected classes</b>: the tool does not collect or use race, religion, national origin, disability, familial status, age or other protected characteristics.</li>
        </ul>
        <p class="small muted">This tool is a decision aid, not legal advice. Laws change, so verify current requirements with the MA Attorney General's Office, MCAD or counsel.</p>
      </div>`;
  }
  function saveSettings() {
    const n = (id, fallback) => { const v = Number(document.getElementById(id).value); return Number.isFinite(v) && v >= 0 ? v : fallback; };
    const s = state.settings;
    s.rentTolerancePct = n('sTol', s.rentTolerancePct);
    s.defaultFlexDays = n('sFlex', s.defaultFlexDays);
    s.earlyAvailabilityDays = n('sEarly', s.earlyAvailabilityDays);
    s.strictLocation = document.getElementById('sStrict').checked;
    for (const k of Object.keys(s.weights)) s.weights[k] = n('w_' + k, s.weights[k]);
    save();
    toast('Settings saved');
  }

  // ---- Global event delegation ----------------------------------------

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; // let links inside clickable rows work
    const hrefRow = e.target.closest('tr[data-href]');
    if (hrefRow && !e.target.closest('a,button')) { location.hash = hrefRow.dataset.href; return; }
    const el = e.target.closest('[data-action]');
    if (!el) {
      if (e.target === modal) closeModal();
      return;
    }
    const d = el.dataset;
    switch (d.action) {
      case 'load-sample': loadSample(); break;
      case 'match-mode': go('match', { mode: d.mode }); break;
      case 'new-applicant': openEditor('applicant'); break;
      case 'new-unit': openEditor('unit'); break;
      case 'edit-applicant': openEditor('applicant', d.id); break;
      case 'edit-unit': openEditor('unit', d.id); break;
      case 'close-modal': closeModal(); break;
      case 'delete-record': {
        const key = d.kind === 'unit' ? 'units' : 'applicants';
        if (!confirm(`Delete ${d.id}? This cannot be undone.`)) break;
        state[key] = state[key].filter((r) => r.id !== d.id);
        state.pipeline = state.pipeline.filter((p) => (d.kind === 'unit' ? p.unitId : p.applicantId) !== d.id);
        save(); closeModal(); toast('Deleted'); render();
        break;
      }
      case 'pipe-add':
        if (!state.pipeline.some((p) => p.applicantId === d.a && p.unitId === d.u)) {
          state.pipeline.push({ applicantId: d.a, unitId: d.u, stage: STAGES[0], notes: '', added: schema.todayISO(), updated: schema.todayISO() });
          save(); toast('Added to pipeline'); render();
        }
        break;
      case 'pipe-remove': state.pipeline.splice(+d.i, 1); save(); render(); break;
      case 'export-all':
        download('ma-rental-matches.csv', matchesToCSV(matcher.matchAll(state.applicants, state.units, state.settings).filter((r) => r.status !== 'not_a_fit')));
        break;
      case 'export-match': {
        const results = d.mode === 'applicant'
          ? matcher.matchApplicant(applicantById(d.id), state.units, state.settings)
          : matcher.matchUnit(unitById(d.id), state.applicants, state.settings);
        download(`matches-${d.id}.csv`, matchesToCSV(results.filter((r) => matchFilters.showNotFit || r.status !== 'not_a_fit')));
        break;
      }
      case 'export-pipeline': {
        const rows = state.pipeline.map((p) => {
          const a = applicantById(p.applicantId) || {}; const u = unitById(p.unitId) || {};
          return { applicant: a.name || p.applicantId, email: a.email, unit: u.id ? `${unitTitle(u)} — ${unitPlace(u)}` : p.unitId, rent: u.rent, landlord: u.landlord, contact: u.contact, stage: p.stage, notes: p.notes, added: p.added, updated: p.updated };
        });
        download('pipeline.csv', csv.stringify(rows));
        break;
      }
      case 'export-records': {
        const kind = d.kind;
        const fields = schema.fieldsFor(kind).filter((f) => !f.importOnly);
        const list = kind === 'unit' ? state.units : state.applicants;
        download(kind === 'unit' ? 'vacancies.csv' : 'applicants.csv', csv.stringify(list, fields.map((f) => ({ key: f.key, label: f.label }))));
        break;
      }
      case 'import-kind': go('import', { kind: d.kind }); break;
      case 'parse-paste': {
        const text = document.getElementById('pasteInput').value;
        if (!text.trim()) { toast('Paste some rows first.'); break; }
        beginImport(d.kind, text, 'Pasted data');
        break;
      }
      case 'do-import': commitImport(); break;
      case 'cancel-import': pendingImport = null; render(); break;
      case 'template': download(d.kind === 'unit' ? 'vacancy-template.csv' : 'applicant-template.csv', schema.templateCSVHeader(d.kind).map((h) => (/[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(',') + '\r\n'); break;
      case 'sample-file': download(d.kind === 'unit' ? 'sample-vacancies.csv' : 'sample-applicants.csv', d.kind === 'unit' ? sampleData.units : sampleData.applicants); break;
      case 'backup': download(`rental-matcher-backup-${schema.todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json'); break;
      case 'clear-all':
        if (confirm('Delete ALL vacancies, applicants and pipeline entries from this browser?')) { state = emptyState(); save(); toast('Workspace cleared'); render(); }
        break;
      case 'save-settings': saveSettings(); break;
      case 'reset-settings': state.settings = matcher.mergeSettings(); save(); render(); toast('Settings reset'); break;
      default: break;
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  document.getElementById('navToggle').onclick = () => document.getElementById('nav').classList.toggle('open');
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/import')) pendingImport = null; render(); });

  render();
})();
