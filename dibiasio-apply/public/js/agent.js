(function () {
  const { esc, money, date, renderFields, summaryHtml } = DRUI;
  const { FORMS, DEAL_SHEET, STATUSES, num } = DR;
  const $app = document.getElementById('app');
  let me = null, config = {}, agents = [];
  const filters = { q: '', status: '', form: '', mine: false };

  /* ------------------------------ plumbing ------------------------------ */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') { me = null; route(); throw new Error('Please sign in.'); }
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function copy(text, label) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast((label || 'Link') + ' copied'), () => prompt('Copy this:', text));
  }
  const statusClass = (s) => ({ New: '', 'In review': 's-review', 'Docs needed': 's-docs', 'Sent to landlord': 's-sent', Approved: 's-ok', 'Lease signed': 's-ok', Denied: 's-bad', Withdrawn: 's-muted' }[s] || '');
  const pill = (s) => '<span class="pill ' + statusClass(s) + '">' + esc(s) + '</span>';
  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return m <= 1 ? 'just now' : m + ' min ago';
    if (m < 1440) return Math.round(m / 60) + ' h ago';
    return new Date(iso).toLocaleDateString();
  };
  const propertyLine = (sheet) => [sheet.address, sheet.unit && 'Unit ' + sheet.unit, sheet.city].filter(Boolean).join(', ');
  const missingDocs = (form, applicant) => form.documents.filter((d) => d.req && !applicant.files.some((f) => f.docType === d.id));
  const firstName = (a) => (a.name || '').split(' ')[0];
  const creditMsg = (a) => 'Hi ' + firstName(a) + ', the landlord needs a credit report for your application. Please complete it here: ' + config.creditScreeningUrl + ' — ' + me.name;
  const docsMsg = (form, a) => 'Hi ' + firstName(a) + ', to finish your application please upload: ' + missingDocs(form, a).map((d) => d.label).join(', ') + '. Use your private link: ' + a.statusUrl + ' — ' + me.name;
  const reopenMsg = (a) => 'Hi ' + firstName(a) + ', please update your rental application' + (a.reopened && a.reopened.note ? ': ' + a.reopened.note : '.') +
    '\n\nYour answers are saved. Open this link, make the changes, then sign again and submit: ' + a.editUrl + ' — ' + me.name;
  const smsLink = (text) => 'sms:?&body=' + encodeURIComponent(text);
  const mailLink = (subject, text, to) => 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);

  // Send from the company mailbox when SMTP is configured; otherwise open the agent's mail app.
  function emailCompose({ to = '', subject, text, dealId, attachGuarantor = false }) {
    if (!config.emailEnabled) {
      if (config.composeWith === 'gmail') {
        const url = 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(me.email) + '&view=cm&fs=1&to=' + encodeURIComponent(to) +
          '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
        window.open(url, '_blank', 'noopener');
      } else {
        location.href = mailLink(subject, text, to);
      }
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<form class="box grid" style="text-align:left;width:min(560px,100%)">
      <div class="fld"><h3 style="margin:0">Send email</h3><span class="small muted">From ${esc(me.name)} | Dibiasio Realty · replies go to ${esc(me.email)}</span></div>
      <div class="fld"><label class="lbl" for="em-to">To</label><input id="em-to" type="email" required value="${esc(to)}" placeholder="applicant@example.com"></div>
      <div class="fld"><label class="lbl" for="em-subject">Subject</label><input id="em-subject" required value="${esc(subject)}"></div>
      ${attachGuarantor ? '<div class="fld small">📎 Guarantor form (PDF) will be attached</div>' : ''}
      <div class="fld"><label class="lbl" for="em-text">Message</label><textarea id="em-text" required style="min-height:160px">${esc(text)}</textarea></div>
      <div class="fld"><div id="em-err" class="notice bad hidden"></div><div class="nav-row" style="margin-top:0"><button type="button" class="btn secondary" data-cancel>Cancel</button><button class="btn">Send</button></div></div>
    </form>`;
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    (to ? overlay.querySelector('#em-text') : overlay.querySelector('#em-to')).focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button:not([data-cancel])');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await api('/api/email', { method: 'POST', body: { to: form.querySelector('#em-to').value, subject: form.querySelector('#em-subject').value, text: form.querySelector('#em-text').value, dealId, attachGuarantor } });
        close();
        toast('Email sent');
      } catch (err) {
        const box = overlay.querySelector('#em-err');
        box.textContent = err.message;
        box.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    };
  }

  /* ------------------------------- routing ------------------------------ */
  window.addEventListener('hashchange', route);
  async function route() {
    if (!me) {
      const r = await fetch('/api/me').then((x) => x.json());
      me = r.agent;
      document.getElementById('storage-warn').classList.toggle('hidden', !r.temporaryStorage);
      if (!me) return renderLogin(r.needsSetup);
      config = await fetch('/api/public/config').then((x) => x.json());
      agents = await api('/api/agents').catch(() => []);
    }
    document.getElementById('nav').classList.remove('hidden');
    renderHealth();
    const [view, arg] = location.hash.replace(/^#/, '').split('/');
    try {
      if (view === 'deal' && arg) return await renderDeal(arg);
      if (view === 'new') return renderNew();
      if (view === 'agents') return await renderAgents();
      return await renderList();
    } catch (e) {
      $app.innerHTML = '<div class="card notice bad">' + esc(e.message) + '</div>';
    }
  }
  // Storage and failed-alert notices, refreshed on every page change.
  async function renderHealth() {
    const box = document.getElementById('health-notices');
    let h;
    try { h = await api('/api/health'); } catch (e) { return; }
    let html = '';
    const st = h.storage;
    if (st && st.level) {
      html += '<div class="notice ' + (st.level === 2 ? 'bad' : 'warn') + '" style="margin:0 0 10px"><b>Storage is ' + st.pct + '% full</b> (' + st.usedMB + ' MB of ' + st.totalMB + ' MB used, ' + st.freeMB + ' MB left). ' +
        (st.level === 2 ? 'New applications may soon fail to save. ' : '') +
        'Increase the disk size in Render: open the <b>dibiasio-apply</b> service, go to <b>Disks</b>, and raise the size.</div>';
    }
    if (h.failures.length) {
      html += '<div class="notice bad" style="margin:0 0 10px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><b>' + h.failures.length + ' alert' + (h.failures.length > 1 ? 's' : '') +
        ' failed to send. Check these so nothing is missed:</b><button class="btn secondary small" id="dismiss-failures">Dismiss</button></div><ul style="margin:8px 0 0;padding-left:20px">' +
        h.failures.map((f) => '<li>' + new Date(f.at).toLocaleString() + ' · ' + (f.dealId ? '<a href="#deal/' + esc(f.dealId) + '">' + esc(f.what) + '</a>' : esc(f.what)) +
          (f.property ? ' · ' + esc(f.property) : '') + '<br><span class="small muted">' + esc(f.error) + '</span></li>').join('') + '</ul></div>';
    }
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
    const d = document.getElementById('dismiss-failures');
    if (d) d.onclick = async () => { await api('/api/health/dismiss', { method: 'POST' }); renderHealth(); };
  }

  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); me = null; location.hash = ''; route(); };

  /* -------------------------------- login ------------------------------- */
  function renderLogin(setup) {
    document.getElementById('nav').classList.add('hidden');
    $app.innerHTML = `<div class="card" style="max-width:440px;margin:30px auto">
      <h1>${setup ? 'Set up your dashboard' : 'Agent sign in'}</h1>
      <p class="muted">${setup ? 'Create the first administrator account. You can add your agents after.' : 'Sign in to review applications and deal sheets.'}</p>
      <form id="login" class="grid">
        ${setup ? '<div class="fld"><label class="lbl" for="l-name">Your name</label><input id="l-name" required autocomplete="name"></div><div class="fld"><label class="lbl" for="l-phone">Phone (shown to applicants)</label><input id="l-phone" type="tel"></div>' : ''}
        <div class="fld"><label class="lbl" for="l-email">Email</label><input id="l-email" type="email" required autocomplete="username"></div>
        <div class="fld"><label class="lbl" for="l-pass">Password</label><input id="l-pass" type="password" required minlength="${setup ? 10 : 1}" autocomplete="${setup ? 'new-password' : 'current-password'}">${setup ? '<div class="help">At least 10 characters.</div>' : ''}</div>
        <div class="fld"><div id="l-err" class="notice bad hidden"></div><button class="btn block">${setup ? 'Create account' : 'Sign in'}</button></div>
      </form></div>`;
    document.getElementById('login').onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => (document.getElementById(id) || {}).value;
      try {
        const r = await api(setup ? '/api/setup' : '/api/login', { method: 'POST', body: { name: v('l-name'), phone: v('l-phone'), email: v('l-email'), password: v('l-pass') } });
        me = r.agent;
        config = await fetch('/api/public/config').then((x) => x.json());
        agents = await api('/api/agents');
        route();
      } catch (err) {
        const el = document.getElementById('l-err');
        el.textContent = err.message;
        el.classList.remove('hidden');
      }
    };
  }

  /* -------------------------------- list -------------------------------- */
  async function renderList() {
    const deals = await api('/api/deals');
    const counts = {};
    deals.forEach((d) => { counts[d.status] = (counts[d.status] || 0) + 1; });
    const personal = location.origin + '/?a=' + me.id;
    $app.innerHTML = `
      <div class="page-head"><h1>Applications</h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" id="my-link">Copy my apply link</button><a class="btn" href="#new">+ New applicant link</a></div></div>
      <div class="stats">${['New', 'In review', 'Docs needed', 'Sent to landlord', 'Approved'].map((s) => '<div class="stat' + (filters.status === s ? ' on' : '') + '" data-s="' + esc(s) + '"><b>' + (counts[s] || 0) + '</b><span>' + esc(s) + '</span></div>').join('')}</div>
      <div class="toolbar">
        <input class="input" id="q" placeholder="Search applicant, property, landlord, notes…" value="${esc(filters.q)}">
        <select class="input" id="fs"><option value="">All statuses</option>${STATUSES.map((s) => '<option' + (s === filters.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('')}</select>
        <select class="input" id="ff"><option value="">All applications</option>${Object.values(FORMS).map((f) => '<option value="' + f.id + '"' + (f.id === filters.form ? ' selected' : '') + '>' + esc(f.short) + '</option>').join('')}</select>
        <label class="small"><input type="checkbox" id="fm"${filters.mine ? ' checked' : ''}> Mine only</label>
      </div>
      <div id="rows"></div>`;
    const draw = () => {
      const q = filters.q.toLowerCase();
      const rows = deals.filter((d) =>
        (!filters.status || d.status === filters.status) && (!filters.form || d.formType === filters.form) && (!filters.mine || d.agentId === me.id) &&
        (!q || [propertyLine(d.sheet), d.sheet.landlord, d.agentName, ...d.applicants.map((a) => a.name + ' ' + a.email), ...d.notes.map((n) => n.text)].join(' ').toLowerCase().includes(q)));
      document.getElementById('rows').innerHTML = rows.length ? `<table class="deals"><thead><tr><th>Property</th><th>Applicants</th><th>Application</th><th>Docs</th><th>Status</th><th>Agent</th><th>Updated</th></tr></thead><tbody>
        ${rows.map((d) => {
          const form = FORMS[d.formType];
          const missing = d.applicants.reduce((n, a) => n + missingDocs(form, a).length, 0);
          return `<tr data-id="${d.id}">
            <td data-l="Property"><b>${esc(propertyLine(d.sheet) || 'No property yet')}</b>${d.sheet.rent ? '<br><span class="muted small">' + money(d.sheet.rent) + '/mo</span>' : ''}${d.notes.length ? '<br><span class="muted small" title="' + esc(d.notes[0].text.slice(0, 200)) + '">📝 ' + d.notes.length + ' note' + (d.notes.length > 1 ? 's' : '') + ' · latest: ' + esc(d.notes[0].text.slice(0, 50)) + (d.notes[0].text.length > 50 ? '…' : '') + '</span>' : ''}</td>
            <td data-l="Applicants">${d.applicants.length ? d.applicants.map((a) => esc(a.name)).join('<br>') : '<span class="muted">Waiting for applicant</span>'}</td>
            <td data-l="Application">${esc(form.short)}</td>
            <td data-l="Docs">${!d.applicants.length ? '—' : missing ? '<span class="pill warn">' + missing + ' missing</span>' : '<span class="pill ok">Complete</span>'}</td>
            <td data-l="Status">${pill(d.status)}${d.applicants.some((a) => a.reopened) ? ' <span class="pill warn" title="Waiting for the applicant to update their application">Sent back</span>' : ''}</td>
            <td data-l="Agent">${esc(d.agentName)}</td>
            <td data-l="Updated" class="muted small">${ago(d.updatedAt)}</td></tr>`;
        }).join('')}</tbody></table>`
        : '<div class="card empty">' + (deals.length ? 'No applications match these filters.' : 'No applications yet. Create an applicant link to get started, or share your apply link.') + '</div>';
      document.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = 'deal/' + tr.dataset.id; });
    };
    document.getElementById('q').oninput = (e) => { filters.q = e.target.value; draw(); };
    document.getElementById('fs').onchange = (e) => { filters.status = e.target.value; renderList(); };
    document.getElementById('ff').onchange = (e) => { filters.form = e.target.value; draw(); };
    document.getElementById('fm').onchange = (e) => { filters.mine = e.target.checked; draw(); };
    document.querySelectorAll('.stat').forEach((s) => s.onclick = () => { filters.status = filters.status === s.dataset.s ? '' : s.dataset.s; renderList(); });
    document.getElementById('my-link').onclick = () => copy(personal, 'Your apply link');
    draw();
  }

  /* ------------------------------ new link ------------------------------ */
  function renderNew() {
    const sheet = {};
    const quick = DEAL_SHEET.filter((f) => ['address', 'unit', 'city', 'bedrooms', 'landlord', 'rent', 'moveIn', 'leaseTerm', 'leaseStart', 'leaseEnd', 'brokerFee', 'feePaidBy', 'securityDeposit'].includes(f.k));
    $app.innerHTML = `<div class="card">
      <h1>New applicant link</h1>
      <p class="muted">Pick the application, add what you know about the apartment, and send the link. Anything you fill in is shown to the applicant and pre-filled on their application. You can complete the full deal sheet later.</p>
      <h3>Which application?</h3>
      <div class="form-pick">${Object.values(FORMS).map((f, i) => '<label><input type="radio" name="ft" value="' + f.id + '"' + (i === 0 ? ' checked' : '') + '><b>' + esc(f.title) + '</b><br><span class="small muted">' + esc(f.blurb) + '</span></label>').join('')}</div>
      <h3>Apartment</h3>
      <div id="sheet"></div>
      <div class="nav-row"><a class="btn secondary" href="#">Cancel</a><button class="btn" id="create">Create link</button></div>
    </div>`;
    renderFields(document.getElementById('sheet'), quick, sheet);
    document.getElementById('create').onclick = async () => {
      const formType = document.querySelector('input[name=ft]:checked').value;
      if (!sheet.firstMonth && sheet.rent) sheet.firstMonth = sheet.rent;
      const deal = await api('/api/deals', { method: 'POST', body: { formType, sheet } });
      renderLinkCreated(deal);
    };
  }

  function linkMessage(deal, extra) {
    const where = propertyLine(deal.sheet);
    return 'Hi! Here is your rental application' + (where ? ' for ' + where : '') + ' with Dibiasio Realty. Fill it out, sign, and upload your ID and pay stubs here: ' + deal.link + (extra ? '\n\n' + extra : '') + ' — ' + me.name;
  }

  const guarantorUrl = () => location.origin + DR.GUARANTOR_URL;
  const guarantorNote = (uploadUrl) => 'If you need a guarantor, here is the Guarantor Form: ' + guarantorUrl() +
    ' Your guarantor fills it out and signs it. Then upload it ' + (uploadUrl ? 'here: ' + uploadUrl : 'with your application') + ' or reply with a copy.';
  const guarantorMessage = (name, uploadUrl) => 'Hi' + (name ? ' ' + name : '') + ', ' + guarantorNote(uploadUrl) + ' — ' + me.name;

  function renderLinkCreated(deal) {
    let msg = linkMessage(deal);
    $app.innerHTML = `<div class="card" style="max-width:720px;margin:0 auto">
      <div class="success-icon">✓</div>
      <h1>Link ready</h1>
      <p class="muted">${esc(FORMS[deal.formType].title)}${propertyLine(deal.sheet) ? ' · ' + esc(propertyLine(deal.sheet)) : ''}. Every applicant who uses this link is added to the same deal.</p>
      <div class="copy-row"><input class="input" readonly value="${esc(deal.link)}"><button class="btn" id="cp">Copy link</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <a class="btn secondary" id="sms" href="${esc(smsLink(msg))}">Text it</a>
        <button class="btn secondary" id="em">Email it</button>
        <button class="btn secondary" id="cpm">Copy message</button>
        <a class="btn ghost" href="#deal/${deal.id}">Open deal →</a>
      </div>
      <label class="small" style="display:block;margin-top:14px"><input type="checkbox" id="with-guarantor"> Include the guarantor form (if they'll need a guarantor)</label>
      </div>`;
    const withGuarantor = document.getElementById('with-guarantor');
    withGuarantor.onchange = () => {
      msg = linkMessage(deal, withGuarantor.checked ? guarantorNote() : '');
      document.getElementById('sms').href = smsLink(msg);
    };
    document.getElementById('cp').onclick = () => copy(deal.link);
    document.getElementById('cpm').onclick = () => copy(msg, 'Message');
    document.getElementById('em').onclick = () => emailCompose({ subject: 'Your rental application', text: msg, dealId: deal.id, attachGuarantor: withGuarantor.checked });
  }

  /* -------------------------------- deal -------------------------------- */
  async function renderDeal(id) {
    const deal = await api('/api/deals/' + id);
    const form = FORMS[deal.formType];
    const sheet = JSON.parse(JSON.stringify(deal.sheet || {}));
    const rent = num(sheet.finalRent || sheet.rent);
    const income = deal.applicants.reduce((n, a) => n + (a.monthlyIncome || 0), 0);
    const ratio = rent ? income / rent : 0;
    const docsMissing = deal.applicants.reduce((n, a) => n + missingDocs(form, a).length, 0);
    const credits = deal.applicants.map((a) => a.credit.status);

    $app.innerHTML = `
      <div class="page-head">
        <div><a href="#" class="small">← All applications</a><h1>${esc(propertyLine(sheet) || 'New deal')}</h1>
          <span class="muted small">${esc(form.title)} · created ${new Date(deal.createdAt).toLocaleDateString()}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <select class="input" id="status" style="width:auto">${STATUSES.map((s) => '<option' + (s === deal.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('')}</select>
          <select class="input" id="assign" style="width:auto"><option value="">Unassigned</option>${agents.map((a) => '<option value="' + a.id + '"' + (a.id === deal.agentId ? ' selected' : '') + '>' + esc(a.name) + '</option>').join('')}</select>
          <a class="btn secondary" href="/agent/print?deal=${deal.id}" target="_blank">Print summary</a>
          ${deal.applicants.length ? '<a class="btn" href="/api/deals/' + deal.id + '/package.pdf" target="_blank" title="Every applicant\'s original form and documents, merged into one PDF for the landlord">📎 Landlord package (PDF)</a>' : ''}
        </div>
      </div>
      <div class="metrics">
        <div class="metric"><span>Rent</span><b>${rent ? money(rent) : '—'}</b></div>
        <div class="metric"><span>Household income / mo</span><b>${income ? money(income) : '—'}</b></div>
        <div class="metric"><span>Income ÷ rent</span><b>${ratio ? ratio.toFixed(2) + '×' : '—'}</b> ${ratio ? (ratio >= form.incomeMultiple ? '<span class="pill ok">meets ' + form.incomeMultiple + '×</span>' : '<span class="pill warn">under ' + form.incomeMultiple + '×</span>') : ''}</div>
        <div class="metric"><span>Documents</span><b>${deal.applicants.length ? (docsMissing ? docsMissing + ' missing' : 'Complete') : '—'}</b></div>
        <div class="metric"><span>Credit</span><b style="font-size:1rem">${credits.length ? credits.map(esc).join(', ') : '—'}</b></div>
      </div>
      <div class="deal-grid">
        <div>
          <div id="applicants"></div>
          <div class="card"><h2>Deal sheet</h2><p class="muted small">Only agents see the deal sheet. Property and lease details you enter here are pre-filled for any new applicants on this link.</p>
            <div id="sheet"></div>
            <div class="sticky-save"><span class="small muted" id="totals"></span><button class="btn" id="save-sheet">Save deal sheet</button></div>
          </div>
        </div>
        <div>
          <div class="card"><h3>Notes</h3>
            <p class="muted small">Private to your team. Never included in landlord forms or packages.</p>
            <textarea class="input" id="note-text" rows="3" placeholder="e.g. Called landlord, waiting on reference…" style="resize:vertical"></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn small" id="note-add">Add note</button></div>
            <ul class="activity" id="notes" style="margin-top:10px"></ul>
          </div>
          <div class="card"><h3>Applicant link</h3><p class="muted small">Send to co-applicants — everyone who applies with it is added here.</p>
            <div class="copy-row"><input class="input" readonly value="${esc(deal.link)}"><button class="btn secondary small" id="cp-link">Copy</button></div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn ghost small" href="${esc(smsLink(linkMessage(deal)))}">Text</a><button class="btn ghost small" id="em-link">Email</button></div>
            <h3 style="margin-top:18px">Guarantor form</h3><p class="muted small">Blank form for applicants who need a guarantor.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost small" href="${esc(DR.GUARANTOR_URL)}" target="_blank">View</a><button class="btn ghost small" id="em-guar">Email form</button><button class="btn ghost small" id="cp-guar">Copy link</button></div>
          </div>
          <div class="card"><h3>Activity</h3><ul class="activity">${(deal.activity || []).map((a) => '<li><time>' + new Date(a.at).toLocaleString() + ' · ' + esc(a.who) + '</time>' + esc(a.text) + '</li>').join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>
          ${me.role === 'admin' ? '<div class="card"><h3>Delete</h3><p class="muted small">Permanently deletes this deal, its applications and documents.</p><button class="btn danger small" id="del">Delete deal</button></div>' : ''}
        </div>
      </div>`;

    renderApplicants(deal, form);
    renderNotes(deal);

    const sheetFields = DEAL_SHEET.concat(form.dealSheet || []);
    renderFields(document.getElementById('sheet'), sheetFields, sheet, { onChange: () => totals() });
    const totals = () => {
      const due = ['firstMonth', 'lastMonth', 'securityDeposit', 'keyLock'].reduce((n, k) => n + num(sheet[k]), 0) + (sheet.feePaidBy === 'Tenant' ? num(sheet.brokerFee) : 0);
      const balance = due - num(sheet.depositCollected);
      document.getElementById('totals').innerHTML = due ? 'Move-in total <b>' + money(due) + '</b> · balance due <b>' + money(balance) + '</b>' : '';
    };
    totals();
    document.getElementById('save-sheet').onclick = async () => { await api('/api/deals/' + id, { method: 'PUT', body: { sheet } }); toast('Deal sheet saved'); renderDeal(id); };
    document.getElementById('status').onchange = async (e) => { await api('/api/deals/' + id, { method: 'PUT', body: { status: e.target.value } }); toast('Status updated'); renderDeal(id); };
    document.getElementById('assign').onchange = async (e) => { await api('/api/deals/' + id, { method: 'PUT', body: { agentId: e.target.value } }); toast('Agent updated'); renderDeal(id); };
    document.getElementById('cp-link').onclick = () => copy(deal.link);
    document.getElementById('em-link').onclick = () => emailCompose({ subject: 'Your rental application', text: linkMessage(deal), dealId: deal.id });
    document.getElementById('em-guar').onclick = () => emailCompose({ subject: 'Guarantor form for your rental application', text: guarantorMessage('', deal.link), dealId: deal.id, attachGuarantor: true });
    document.getElementById('cp-guar').onclick = () => copy(guarantorUrl(), 'Guarantor form link');
    const del = document.getElementById('del');
    if (del) del.onclick = async () => {
      if (!confirm('Permanently delete this deal and all of its applications and documents?')) return;
      await api('/api/deals/' + id, { method: 'DELETE' });
      location.hash = '';
    };
  }

  function renderNotes(deal) {
    const list = document.getElementById('notes');
    list.innerHTML = deal.notes.length ? deal.notes.map((n) => '<li><time>' + new Date(n.at).toLocaleString() + ' · ' + esc(n.by) +
      ((n.byId === me.id || me.role === 'admin') ? ' · <a href="#" data-del-note="' + esc(n.id) + '">Delete</a>' : '') + '</time>' +
      '<span style="white-space:pre-wrap">' + esc(n.text) + '</span></li>').join('') : '<li class="muted">No notes yet.</li>';
    list.querySelectorAll('[data-del-note]').forEach((a) => a.onclick = async (e) => {
      e.preventDefault();
      if (!confirm('Delete this note?')) return;
      deal.notes = await api('/api/deals/' + deal.id + '/notes/' + a.dataset.delNote, { method: 'DELETE' });
      renderNotes(deal);
    });
    const text = document.getElementById('note-text');
    document.getElementById('note-add').onclick = async () => {
      if (!text.value.trim()) return text.focus();
      try {
        deal.notes = await api('/api/deals/' + deal.id + '/notes', { method: 'POST', body: { text: text.value } });
        text.value = '';
        renderNotes(deal);
        toast('Note added');
      } catch (e) { toast(e.message); }
    };
  }

  function renderApplicants(deal, form) {
    const box = document.getElementById('applicants');
    if (!deal.applicants.length) {
      box.innerHTML = '<div class="card empty">No one has applied with this link yet. Send it to your applicant and you\'ll see their application here.</div>';
      return;
    }
    box.innerHTML = deal.applicants.map((a, i) => {
      const app = a.application;
      const docs = form.documents.concat([{ id: 'other', label: 'Other documents' }, { id: 'credit_report', label: 'Credit report' }]);
      const filesFor = (id) => a.files.filter((f) => f.docType === id || (id === 'other' && !docs.some((d) => d.id === f.docType)));
      const missing = missingDocs(form, a);
      return `<div class="card" data-app="${a.id}">
        <div class="applicant-head">
          <div><span class="step-label">Applicant ${i + 1}</span><h2 style="margin:0">${esc(a.name)}</h2>
            <span class="small">${a.email ? '<a href="mailto:' + esc(a.email) + '">' + esc(a.email) + '</a>' : ''}${a.phone ? ' · <a href="tel:' + esc(a.phone) + '">' + esc(a.phone) + '</a>' : ''}</span><br>
            <span class="muted small">Submitted ${new Date(a.createdAt).toLocaleString()}${a.resubmittedAt ? ' · <b>updated ' + new Date(a.resubmittedAt).toLocaleString() + '</b>' : ''} · income ${a.monthlyIncome ? money(a.monthlyIncome) + '/mo' : 'not stated'}</span></div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${missing.length ? '<span class="pill warn">' + missing.length + ' doc(s) missing</span>' : '<span class="pill ok">Docs complete</span>'}
            <a class="btn secondary small" href="/api/apps/${a.id}/original.pdf" target="_blank" title="The applicant's answers printed on ${esc(form.name)}'s original form">📄 ${esc(form.short)} form (PDF)</a>
            <a class="btn small" href="/api/apps/${a.id}/package.pdf" target="_blank" title="${esc(form.short)} form followed by the applicant's ID, pay stubs and other documents, merged into one PDF">📎 Form + documents (PDF)</a></div>
        </div>

        ${reopenHtml(form, a)}

        <h4 style="margin:16px 0 0">Document checklist</h4>
        <ul class="checklist">${docs.map((d) => {
          const files = filesFor(d.id);
          if (!files.length && !d.req && (d.id === 'other' || d.id === 'credit_report')) return '';
          return '<li><div class="row"><span>' + (files.length ? '✅' : d.req ? '⚠️' : '▫️') + ' ' + esc(d.label) + '</span>' + (files.length ? '' : d.req ? '<span class="pill warn">Missing</span>' : '<span class="muted small">If applicable</span>') + '</div>' +
            (files.length ? '<div class="files">' + files.map((f) => '<label class="pkg" title="Include in the merged PDF"><input type="checkbox" data-pkg="' + f.id + '"' + (f.inPackage ? ' checked' : '') + '></label><a href="/api/files/' + a.id + '/' + f.id + '" target="_blank" title="' + esc(f.name) + '">' + esc(f.name) + (f.by === 'agent' ? ' (agent)' : '') + '</a><a href="/api/files/' + a.id + '/' + f.id + '?download=1" title="Download">⬇</a>' + (/^image\//.test(f.mime) ? '<a href="/api/files/' + a.id + '/' + f.id + '?as=pdf" target="_blank" title="Open this photo as a PDF">PDF</a>' : '')).join('') + '</div>' : '') + '</li>';
        }).join('')}</ul>
        <p class="small muted" style="margin:-4px 0 10px">Tick the documents to include in the merged PDF (<span data-pkg-count></span>).</p>
        <div class="inline-form">
          <select class="input" data-up-type>${docs.map((d) => '<option value="' + d.id + '">' + esc(d.label) + '</option>').join('')}</select>
          <label class="btn secondary small">Upload for applicant<input type="file" multiple class="hidden" data-up></label>
          ${missing.length ? '<button class="btn ghost small" data-email-docs>Email “please upload” request</button><button class="btn ghost small" data-req-docs>Copy message</button>' : ''}
          ${a.email ? '<button class="btn ghost small" data-email-app>Email applicant</button><button class="btn ghost small" data-email-guar>Email guarantor form</button>' : ''}
          <button class="btn ghost small" data-status-link>Copy applicant's upload link</button>
        </div>

        <div class="subcard"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h4 style="margin:0">Credit report</h4><button class="btn small" data-ygl>Credit check (YGL)</button></div>
          <div class="inline-form">
            <select class="input" data-credit>${['Not requested', 'Requested', 'Received', 'Waived'].map((s) => '<option' + (s === a.credit.status ? ' selected' : '') + '>' + s + '</option>').join('')}</select>
            <input class="input" data-score placeholder="Score" value="${esc(a.credit.score || '')}" style="max-width:110px">
            <input class="input" data-cnotes placeholder="Notes (e.g. collections, judgments)" value="${esc(a.credit.notes || '')}">
            <button class="btn secondary small" data-credit-save>Save</button>
          </div>
          <div class="inline-form" style="margin-top:8px">
            ${config.creditScreeningUrl ? '<button class="btn ghost small" data-email-credit>Email credit-check request</button><button class="btn ghost small" data-credit-msg>Copy request</button><a class="btn ghost small" href="' + esc(smsLink(creditMsg(a))) + '">Text request</a>' : '<span class="small muted">Tip: set CREDIT_SCREENING_URL to your screening provider\'s applicant link to send credit-check requests in one tap.</span>'}
            <label class="btn ghost small">Upload credit report<input type="file" class="hidden" data-credit-up accept="application/pdf,image/*"></label>
          </div>
          ${a.credit.updatedAt ? '<div class="help">Updated ' + new Date(a.credit.updatedAt).toLocaleString() + ' by ' + esc(a.credit.by || '') + '</div>' : ''}
        </div>

        <details class="full"><summary>View full application</summary>
          <div style="margin:10px 0"><label class="small"><input type="checkbox" data-reveal> Show full SSN</label></div>
          <div data-full>${fullApplicationHtml(form, app, false)}</div>
        </details>
        ${a.history.length ? '<details class="full"><summary>Previous versions (' + a.history.length + ')</summary>' + a.history.map((h) => '<div class="subcard"><h4 style="margin:0">Signed ' + new Date(h.submittedAt).toLocaleString() + ', replaced ' + new Date(h.replacedAt).toLocaleString() + '</h4>' + (h.note ? '<p class="small muted">You asked: ' + esc(h.note) + '</p>' : '') + fullApplicationHtml(form, h.application, false) + '</div>').join('') + '</details>' : ''}
      </div>`;
    }).join('');

    deal.applicants.forEach((a) => {
      const card = box.querySelector('[data-app="' + a.id + '"]');
      const q = (sel) => card.querySelector(sel);
      q('[data-reveal]').onchange = (e) => { q('[data-full]').innerHTML = fullApplicationHtml(form, a.application, e.target.checked); };
      q('[data-up]').onchange = (e) => uploadFor(a.id, q('[data-up-type]').value, e.target.files, deal.id);
      q('[data-credit-up]').onchange = (e) => uploadFor(a.id, 'credit_report', e.target.files, deal.id);
      q('[data-status-link]').onclick = () => copy(a.statusUrl, 'Upload link');
      const rd = q('[data-req-docs]');
      if (rd) rd.onclick = () => copy(docsMsg(form, a), 'Message');
      const ed = q('[data-email-docs]');
      if (ed) ed.onclick = () => emailCompose({ to: a.email, subject: 'Documents needed for your rental application', text: docsMsg(form, a), dealId: deal.id });
      const pkgCount = () => { q('[data-pkg-count]').textContent = a.files.filter((f) => f.inPackage).length + ' of ' + a.files.length + ' included'; };
      pkgCount();
      card.querySelectorAll('[data-pkg]').forEach((box) => box.onchange = async () => {
        const f = a.files.find((x) => x.id === box.dataset.pkg);
        try {
          await api('/api/apps/' + a.id + '/files/' + f.id, { method: 'PUT', body: { inPackage: box.checked } });
          f.inPackage = box.checked;
          pkgCount();
          toast(box.checked ? 'Included in the PDF' : 'Left out of the PDF');
        } catch (e) { box.checked = !box.checked; toast(e.message); }
      });
      const eg = q('[data-email-guar]');
      if (eg) eg.onclick = () => emailCompose({ to: a.email, subject: 'Guarantor form for your rental application', text: guarantorMessage(firstName(a), a.statusUrl), dealId: deal.id, attachGuarantor: true });
      const ea = q('[data-email-app]');
      if (ea) ea.onclick = () => emailCompose({ to: a.email, subject: 'Your rental application' + (propertyLine(deal.sheet) ? ' – ' + propertyLine(deal.sheet) : ''), text: 'Hi ' + firstName(a) + ',\n\n\n\n' + me.name + '\nDibiasio Realty' + (me.phone ? '\n' + me.phone : ''), dealId: deal.id });
      const rb = q('[data-reopen]');
      if (rb) rb.onclick = () => askReopen(a, deal.id);
      const rc = q('[data-reopen-close]');
      if (rc) rc.onclick = async () => {
        if (!confirm('Close ' + a.name + '\'s application to changes? Their update link will stop working.')) return;
        await api('/api/apps/' + a.id + '/reopen', { method: 'DELETE' });
        toast('Closed to changes');
        renderDeal(deal.id);
      };
      const rcp = q('[data-reopen-copy]');
      if (rcp) rcp.onclick = () => copy(reopenMsg(a), 'Message');
      const rem = q('[data-reopen-email]');
      if (rem) rem.onclick = () => emailCompose({ to: a.email, subject: 'Please update your rental application', text: reopenMsg(a), dealId: deal.id });
      q('[data-ygl]').onclick = () => DRYGL.open({
        formId: form.id, answers: a.application.answers, applicantName: a.name, copy, toast,
        onCopied: async () => {
          if (a.credit.status !== 'Not requested') return;
          a.credit = await api('/api/apps/' + a.id + '/credit', { method: 'PUT', body: { status: 'Requested', notes: a.credit.notes || 'Run on YouGotListings' } }).then((r) => r.credit);
          const sel = q('[data-credit]');
          if (sel) sel.value = 'Requested';
        },
      });
      const ec = q('[data-email-credit]');
      if (ec) ec.onclick = async () => {
        emailCompose({ to: a.email, subject: 'Credit check for your rental application', text: creditMsg(a), dealId: deal.id });
        if (a.credit.status === 'Not requested') await api('/api/apps/' + a.id + '/credit', { method: 'PUT', body: { status: 'Requested' } });
      };
      const cm = q('[data-credit-msg]');
      if (cm) cm.onclick = async () => {
        copy(creditMsg(a), 'Credit-check request');
        if (a.credit.status === 'Not requested') { await api('/api/apps/' + a.id + '/credit', { method: 'PUT', body: { status: 'Requested' } }); renderDeal(deal.id); }
      };
      q('[data-credit-save]').onclick = async () => {
        await api('/api/apps/' + a.id + '/credit', { method: 'PUT', body: { status: q('[data-credit]').value, score: q('[data-score]').value, notes: q('[data-cnotes]').value } });
        toast('Credit status saved');
        renderDeal(deal.id);
      };
    });
  }

  async function uploadFor(appId, docType, files, dealId) {
    if (!files.length) return;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('doc_' + docType, f, f.name));
    try {
      await api('/api/apps/' + appId + '/files', { method: 'POST', body: fd });
      toast('Uploaded');
    } catch (e) { toast(e.message); }
    renderDeal(dealId);
  }

  /* --------------------- sending an application back --------------------- */
  // Every answer as "Section › Label" → { v: full value, show: what to display (SSNs masked) }.
  function flatAnswers(form, answers) {
    const out = {};
    const walk = (fields, scope, prefix) => {
      let section = prefix;
      fields.forEach((f) => {
        if (f.type === 'heading') { section = prefix + f.label + ' › '; return; }
        if (!f.k) return;
        if (f.type === 'group') { (scope[f.k] || []).forEach((item, i) => walk(f.fields, item || {}, prefix + f.itemLabel(i) + ' › ')); return; }
        const v = DRUI.display(f, scope[f.k], { revealSsn: true });
        if (v) out[section + f.label] = { v, show: f.type === 'ssn' ? DRUI.maskSsn(v) : v };
      });
    };
    form.steps.forEach((st) => walk(st.fields, answers || {}, ''));
    return out;
  }
  function changesHtml(form, before, after) {
    const a = flatAnswers(form, before), b = flatAnswers(form, after);
    const keys = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter((k) => (a[k] && a[k].v) !== (b[k] && b[k].v));
    if (!keys.length) return '<p class="small muted" style="margin:6px 0 0">No answers changed (they may have re-signed or added documents).</p>';
    return '<dl class="kv small" style="margin-top:6px">' + keys.map((k) => '<dt>' + esc(k) + '</dt><dd>' + (a[k] ? '<s class="muted">' + esc(a[k].show) + '</s> → ' : '') + (b[k] ? '<b>' + esc(b[k].show) + '</b>' : '<span class="muted">removed</span>') + '</dd>').join('') + '</dl>';
  }

  function reopenHtml(form, a) {
    if (a.reopened) {
      return '<div class="notice warn" style="margin-top:14px"><b>Sent back for changes</b> ' + new Date(a.reopened.at).toLocaleString() + ' by ' + esc(a.reopened.by) +
        (a.reopened.note ? '<br>“' + esc(a.reopened.note) + '”' : '') + '<br><span class="small">Waiting for ' + esc(firstName(a)) + ' to update and re-sign. Send them the link:</span>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' + (a.email ? '<button class="btn small" data-reopen-email>Email link</button>' : '') +
        '<a class="btn ghost small" href="' + esc(smsLink(reopenMsg(a))) + '">Text link</a><button class="btn ghost small" data-reopen-copy>Copy message</button>' +
        '<button class="btn ghost small" data-reopen-close>Close to changes</button></div></div>';
    }
    const latest = a.history[0];
    return (latest ? '<div class="subcard" style="margin-top:14px"><h4 style="margin:0">Changes in the latest update</h4>' + changesHtml(form, latest.application.answers, a.application.answers) + '</div>' : '') +
      '<div style="margin-top:12px"><button class="btn secondary small" data-reopen title="Let the applicant finish or correct their application, then sign again">↩ Send back to applicant to finish</button></div>';
  }

  function askReopen(a, dealId) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = '<div class="box" style="text-align:left;width:min(560px,100%)"><h3 style="margin-top:0">Send back to ' + esc(a.name) + '</h3>' +
      '<p class="small muted">They\'ll be able to open their saved answers, change or add anything, upload documents, then sign again and resubmit. You\'ll get an alert when they do. The current version is kept.</p>' +
      '<label class="lbl" for="reopen-note">What do they need to finish or fix?</label><textarea class="input" id="reopen-note" rows="4" placeholder="e.g. Please add your previous landlord and your employer\'s phone number." style="resize:vertical"></textarea>' +
      '<div class="nav-row"><button class="btn secondary" data-cancel>Cancel</button><button class="btn" data-ok>Send back</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('textarea').focus();
    overlay.querySelector('[data-cancel]').onclick = () => overlay.remove();
    overlay.querySelector('[data-ok]').onclick = async () => {
      try {
        await api('/api/apps/' + a.id + '/reopen', { method: 'POST', body: { note: overlay.querySelector('textarea').value } });
        overlay.remove();
        toast('Sent back. Now email or text them the link.');
        renderDeal(dealId);
      } catch (e) { toast(e.message); }
    };
  }

  function fullApplicationHtml(form, app, revealSsn) {
    const a = app.answers || {};
    const sig = app.signature || {};
    return form.steps.map((s) => '<div class="review-section"><h3>' + esc(s.title) + '</h3>' + summaryHtml(s.fields, a, { revealSsn }) + '</div>').join('') +
      '<div class="review-section"><h3>Signature</h3><dl class="kv"><dt>Signed as</dt><dd>' + esc(sig.typedName) + '</dd><dt>Signed at</dt><dd>' + (sig.signedAt ? new Date(sig.signedAt).toLocaleString() : '') + '</dd><dt>IP address</dt><dd>' + esc(sig.ip || '') + '</dd>' +
      '<dt>Consents</dt><dd>' + ['terms', 'credit', 'esign'].filter((k) => app.consents && app.consents[k]).map((k) => ({ terms: 'Certification', credit: 'Credit/background check', esign: 'E-signature' }[k])).join(', ') + '</dd>' +
      ((app.otherSigners || []).length ? '<dt>Other adults</dt><dd>' + app.otherSigners.map((o) => esc(o.member) + ' — signed “' + esc(o.name) + '”').join('<br>') + '</dd>' : '') +
      '</dl>' + (sig.image ? '<img class="sig-img" src="' + esc(sig.image) + '" alt="Signature">' : '') + '</div>';
  }

  /* -------------------------------- team -------------------------------- */
  async function renderAgents() {
    agents = await api('/api/agents');
    const admin = me.role === 'admin';
    $app.innerHTML = `
      <div class="page-head"><h1>Team</h1></div>
      <div class="card"><h2>Credit checks on YouGotListings</h2>
        <p class="muted small">One-time setup: drag this button to your browser's bookmarks bar. If the bookmarks bar is hidden, press Ctrl+Shift+B (Cmd+Shift+B on a Mac).</p>
        <p><a class="btn secondary" id="ygl-bookmarklet" href="#" title="Drag me to your bookmarks bar">🔖 Fill from Dibiasio</a></p>
        <p class="muted small" style="margin:0">Then on an application, click <b>Credit check (YGL)</b> → <b>Copy &amp; open YGL</b>. On YGL's credit report page, click the <b>Fill from Dibiasio</b> bookmark, review the filled fields, and submit.</p>
      </div>
      <div class="card"><h2>Your apply links</h2><p class="muted small">Post these on listings or send them to anyone. Applications come straight to you.</p>
        ${Object.values(FORMS).map((f) => { const url = location.origin + '/apply?f=' + f.id + '&a=' + me.id; return '<div class="copy-row" style="margin-bottom:8px"><input class="input" readonly value="' + esc(url) + '"><button class="btn secondary small" data-copy="' + esc(url) + '">Copy ' + esc(f.short) + '</button></div>'; }).join('')}
        <div class="copy-row"><input class="input" readonly value="${esc(location.origin + '/?a=' + me.id)}"><button class="btn secondary small" data-copy="${esc(location.origin + '/?a=' + me.id)}">Copy chooser</button></div>
      </div>
      <div class="card"><h2>Alerts</h2><p class="muted small">New applications and document uploads send you an alert. Use this to check it's working.</p>
        <button class="btn secondary" id="test-alert">Send test alert</button> <span class="small" id="test-alert-result"></span></div>
      <div class="card"><h2>Agents</h2>
        <table class="deals"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th></th></tr></thead><tbody>
        ${agents.map((a) => '<tr><td data-l="Name">' + esc(a.name) + '</td><td data-l="Email">' + esc(a.email) + '</td><td data-l="Phone">' + esc(a.phone) + '</td><td data-l="Role">' + esc(a.role) + '</td><td>' +
          (admin || a.id === me.id ? '<button class="btn ghost small" data-edit="' + a.id + '">Edit</button><button class="btn ghost small" data-pw="' + a.id + '">Set password</button>' : '') +
          (admin && a.id !== me.id ? '<button class="btn ghost small" data-rm="' + a.id + '">Remove</button>' : '') + '</td></tr>').join('')}
        </tbody></table>
      </div>
      ${admin ? `<div class="card"><h2>Add an agent</h2><form id="add" class="grid">
        <div class="fld third"><label class="lbl" for="a-name">Name</label><input id="a-name" required></div>
        <div class="fld third"><label class="lbl" for="a-email">Email</label><input id="a-email" type="email" required></div>
        <div class="fld third"><label class="lbl" for="a-phone">Phone</label><input id="a-phone" type="tel"></div>
        <div class="fld half"><label class="lbl" for="a-pass">Temporary password</label><input id="a-pass" required minlength="10"><div class="help">At least 10 characters. Share it with the agent privately.</div></div>
        <div class="fld half"><label class="lbl" for="a-role">Role</label><select id="a-role"><option value="agent">Agent</option><option value="admin">Admin (can add agents & delete deals)</option></select></div>
        <div class="fld"><button class="btn">Add agent</button></div></form></div>` : ''}`;
    $app.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => copy(b.dataset.copy));
    const bm = document.getElementById('ygl-bookmarklet');
    bm.href = DRYGL.bookmarklet();
    bm.onclick = (e) => { e.preventDefault(); toast('Drag this button to your bookmarks bar'); };
    document.getElementById('test-alert').onclick = async (e) => {
      const out = document.getElementById('test-alert-result');
      e.target.disabled = true;
      out.textContent = 'Sending…';
      try {
        await api('/api/alerts/test', { method: 'POST' });
        out.textContent = 'Sent! Check your phone and email.';
      } catch (err) { out.textContent = err.message; }
      e.target.disabled = false;
    };
    $app.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
      const agent = agents.find((x) => x.id === b.dataset.edit);
      const name = prompt('Name (shown to applicants and on emails):', agent.name);
      if (name == null) return;
      const phone = prompt('Phone (shown to applicants):', agent.phone || '');
      if (phone == null) return;
      try {
        const updated = await api('/api/agents/' + agent.id, { method: 'PUT', body: { name, phone } });
        if (updated.id === me.id) me = updated;
        toast('Profile updated');
        renderAgents();
      } catch (e) { alert(e.message); }
    });
    $app.querySelectorAll('[data-pw]').forEach((b) => b.onclick = async () => {
      const pw = prompt('New password (at least 10 characters):');
      if (!pw) return;
      try { await api('/api/agents/' + b.dataset.pw + '/password', { method: 'POST', body: { password: pw } }); toast('Password updated'); } catch (e) { alert(e.message); }
    });
    $app.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
      if (!confirm('Remove this agent? Their deals stay in the system.')) return;
      await api('/api/agents/' + b.dataset.rm, { method: 'DELETE' });
      renderAgents();
    });
    const add = document.getElementById('add');
    if (add) add.onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => document.getElementById(id).value;
      try {
        await api('/api/agents', { method: 'POST', body: { name: v('a-name'), email: v('a-email'), phone: v('a-phone'), password: v('a-pass'), role: v('a-role') } });
        toast('Agent added');
        renderAgents();
      } catch (err) { alert(err.message); }
    };
  }

  route();
})();
