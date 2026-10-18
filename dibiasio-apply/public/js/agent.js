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
  const smsLink = (text) => 'sms:?&body=' + encodeURIComponent(text);
  const mailLink = (subject, text, to) => 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);

  // Send from the company mailbox when SMTP is configured; otherwise open the agent's mail app.
  function emailCompose({ to = '', subject, text, dealId }) {
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
        await api('/api/email', { method: 'POST', body: { to: form.querySelector('#em-to').value, subject: form.querySelector('#em-subject').value, text: form.querySelector('#em-text').value, dealId } });
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
        <input class="input" id="q" placeholder="Search applicant, property, landlord…" value="${esc(filters.q)}">
        <select class="input" id="fs"><option value="">All statuses</option>${STATUSES.map((s) => '<option' + (s === filters.status ? ' selected' : '') + '>' + esc(s) + '</option>').join('')}</select>
        <select class="input" id="ff"><option value="">All applications</option>${Object.values(FORMS).map((f) => '<option value="' + f.id + '"' + (f.id === filters.form ? ' selected' : '') + '>' + esc(f.short) + '</option>').join('')}</select>
        <label class="small"><input type="checkbox" id="fm"${filters.mine ? ' checked' : ''}> Mine only</label>
      </div>
      <div id="rows"></div>`;
    const draw = () => {
      const q = filters.q.toLowerCase();
      const rows = deals.filter((d) =>
        (!filters.status || d.status === filters.status) && (!filters.form || d.formType === filters.form) && (!filters.mine || d.agentId === me.id) &&
        (!q || [propertyLine(d.sheet), d.sheet.landlord, d.agentName, ...d.applicants.map((a) => a.name + ' ' + a.email)].join(' ').toLowerCase().includes(q)));
      document.getElementById('rows').innerHTML = rows.length ? `<table class="deals"><thead><tr><th>Property</th><th>Applicants</th><th>Application</th><th>Docs</th><th>Status</th><th>Agent</th><th>Updated</th></tr></thead><tbody>
        ${rows.map((d) => {
          const form = FORMS[d.formType];
          const missing = d.applicants.reduce((n, a) => n + missingDocs(form, a).length, 0);
          return `<tr data-id="${d.id}">
            <td data-l="Property"><b>${esc(propertyLine(d.sheet) || 'No property yet')}</b>${d.sheet.rent ? '<br><span class="muted small">' + money(d.sheet.rent) + '/mo</span>' : ''}</td>
            <td data-l="Applicants">${d.applicants.length ? d.applicants.map((a) => esc(a.name)).join('<br>') : '<span class="muted">Waiting for applicant</span>'}</td>
            <td data-l="Application">${esc(form.short)}</td>
            <td data-l="Docs">${!d.applicants.length ? '—' : missing ? '<span class="pill warn">' + missing + ' missing</span>' : '<span class="pill ok">Complete</span>'}</td>
            <td data-l="Status">${pill(d.status)}</td>
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

  function linkMessage(deal) {
    const where = propertyLine(deal.sheet);
    return 'Hi! Here is your rental application' + (where ? ' for ' + where : '') + ' with Dibiasio Realty. Fill it out, sign, and upload your ID and pay stubs here: ' + deal.link + ' — ' + me.name;
  }

  function renderLinkCreated(deal) {
    const msg = linkMessage(deal);
    $app.innerHTML = `<div class="card" style="max-width:720px;margin:0 auto">
      <div class="success-icon">✓</div>
      <h1>Link ready</h1>
      <p class="muted">${esc(FORMS[deal.formType].title)}${propertyLine(deal.sheet) ? ' · ' + esc(propertyLine(deal.sheet)) : ''}. Every applicant who uses this link is added to the same deal.</p>
      <div class="copy-row"><input class="input" readonly value="${esc(deal.link)}"><button class="btn" id="cp">Copy link</button></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <a class="btn secondary" href="${esc(smsLink(msg))}">Text it</a>
        <button class="btn secondary" id="em">Email it</button>
        <button class="btn secondary" id="cpm">Copy message</button>
        <a class="btn ghost" href="#deal/${deal.id}">Open deal →</a>
      </div></div>`;
    document.getElementById('cp').onclick = () => copy(deal.link);
    document.getElementById('cpm').onclick = () => copy(msg, 'Message');
    document.getElementById('em').onclick = () => emailCompose({ subject: 'Your rental application', text: msg, dealId: deal.id });
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
          <div class="card"><h3>Applicant link</h3><p class="muted small">Send to co-applicants — everyone who applies with it is added here.</p>
            <div class="copy-row"><input class="input" readonly value="${esc(deal.link)}"><button class="btn secondary small" id="cp-link">Copy</button></div>
            <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn ghost small" href="${esc(smsLink(linkMessage(deal)))}">Text</a><button class="btn ghost small" id="em-link">Email</button></div>
          </div>
          <div class="card"><h3>Activity</h3><ul class="activity">${(deal.activity || []).map((a) => '<li><time>' + new Date(a.at).toLocaleString() + ' · ' + esc(a.who) + '</time>' + esc(a.text) + '</li>').join('') || '<li class="muted">Nothing yet.</li>'}</ul></div>
          ${me.role === 'admin' ? '<div class="card"><h3>Delete</h3><p class="muted small">Permanently deletes this deal, its applications and documents.</p><button class="btn danger small" id="del">Delete deal</button></div>' : ''}
        </div>
      </div>`;

    renderApplicants(deal, form);

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
    const del = document.getElementById('del');
    if (del) del.onclick = async () => {
      if (!confirm('Permanently delete this deal and all of its applications and documents?')) return;
      await api('/api/deals/' + id, { method: 'DELETE' });
      location.hash = '';
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
            <span class="muted small">Submitted ${new Date(a.createdAt).toLocaleString()} · income ${a.monthlyIncome ? money(a.monthlyIncome) + '/mo' : 'not stated'}</span></div>
          <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end">${missing.length ? '<span class="pill warn">' + missing.length + ' doc(s) missing</span>' : '<span class="pill ok">Docs complete</span>'}
            <a class="btn secondary small" href="/api/apps/${a.id}/original.pdf" target="_blank" title="The applicant's answers printed on ${esc(form.name)}'s original form">📄 ${esc(form.short)} form (PDF)</a>
            <a class="btn small" href="/api/apps/${a.id}/package.pdf" target="_blank" title="${esc(form.short)} form followed by the applicant's ID, pay stubs and other documents, merged into one PDF">📎 Form + documents (PDF)</a></div>
        </div>

        <h4 style="margin:16px 0 0">Document checklist</h4>
        <ul class="checklist">${docs.map((d) => {
          const files = filesFor(d.id);
          if (!files.length && !d.req && (d.id === 'other' || d.id === 'credit_report')) return '';
          return '<li><div class="row"><span>' + (files.length ? '✅' : d.req ? '⚠️' : '▫️') + ' ' + esc(d.label) + '</span>' + (files.length ? '' : d.req ? '<span class="pill warn">Missing</span>' : '<span class="muted small">If applicable</span>') + '</div>' +
            (files.length ? '<div class="files">' + files.map((f) => '<a href="/api/files/' + a.id + '/' + f.id + '" target="_blank" title="' + esc(f.name) + '">' + esc(f.name) + (f.by === 'agent' ? ' (agent)' : '') + '</a><a href="/api/files/' + a.id + '/' + f.id + '?download=1" title="Download">⬇</a>' + (/^image\//.test(f.mime) ? '<a href="/api/files/' + a.id + '/' + f.id + '?as=pdf" target="_blank" title="Open this photo as a PDF">PDF</a>' : '')).join('') + '</div>' : '') + '</li>';
        }).join('')}</ul>
        <div class="inline-form">
          <select class="input" data-up-type>${docs.map((d) => '<option value="' + d.id + '">' + esc(d.label) + '</option>').join('')}</select>
          <label class="btn secondary small">Upload for applicant<input type="file" multiple class="hidden" data-up></label>
          ${missing.length ? '<button class="btn ghost small" data-email-docs>Email “please upload” request</button><button class="btn ghost small" data-req-docs>Copy message</button>' : ''}
          ${a.email ? '<button class="btn ghost small" data-email-app>Email applicant</button>' : ''}
          <button class="btn ghost small" data-status-link>Copy applicant's upload link</button>
        </div>

        <div class="subcard"><h4>Credit report</h4>
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
      const ea = q('[data-email-app]');
      if (ea) ea.onclick = () => emailCompose({ to: a.email, subject: 'Your rental application' + (propertyLine(deal.sheet) ? ' – ' + propertyLine(deal.sheet) : ''), text: 'Hi ' + firstName(a) + ',\n\n\n\n' + me.name + '\nDibiasio Realty' + (me.phone ? '\n' + me.phone : ''), dealId: deal.id });
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
