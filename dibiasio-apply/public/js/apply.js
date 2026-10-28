(function () {
  const { esc, renderFields, summaryHtml, money } = DRUI;
  const { t } = DRI18N;
  const $app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const dealToken = params.get('d');
  const agentId = params.get('a');
  const MAX_FILE = 20 * 1024 * 1024;

  let form, deal = null, config = {}, lang = 'en';
  let stepIndex = 0;
  let steps = [];
  const state = { answers: {}, files: {}, signature: { typedName: '', image: '' }, otherSigners: [], consents: {} };

  /* ---------------------------- draft saving ---------------------------- */
  const draftKey = () => 'dr-draft:' + (dealToken || form.id);
  // SSNs, ITINs and account numbers never touch browser storage.
  function stripSensitive(fields, scope) {
    const out = {};
    fields.forEach((f) => {
      if (!f.k || scope[f.k] == null) return;
      if (f.type === 'group') out[f.k] = (scope[f.k] || []).map((item) => stripSensitive(f.fields, item || {}));
      else if (f.type !== 'ssn' && !f.sensitive) out[f.k] = scope[f.k];
    });
    return out;
  }
  let saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const answers = stripSensitive(form.steps.flatMap((s) => s.fields), state.answers);
        localStorage.setItem(draftKey(), JSON.stringify({ answers, stepIndex, savedAt: Date.now() }));
        document.getElementById('saved-note').textContent = t('Progress saved on this device');
      } catch (e) { /* storage unavailable: nothing to do */ }
    }, 400);
  }
  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (draft && Date.now() - draft.savedAt < 30 * 864e5) return draft;
    } catch (e) { /* ignore */ }
    return null;
  }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } }

  /* ------------------------------- setup -------------------------------- */
  async function init() {
    config = await fetch('/api/public/config').then((r) => r.json()).catch(() => ({}));
    if (dealToken) {
      const res = await fetch('/api/public/deal/' + encodeURIComponent(dealToken));
      const body = await res.json();
      if (!res.ok) return fatal(body.error);
      deal = body;
      form = DR.FORMS[deal.formType];
      lang = deal.lang || 'en';
    } else {
      form = DR.FORMS[params.get('f')];
      if (!form) { location.href = '/'; return; }
      if (agentId) {
        const agent = await fetch('/api/public/agent/' + encodeURIComponent(agentId)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (agent) deal = { agent, prefill: {}, property: {} };
      }
    }
    // ?lang= on the link wins over the agent's choice; only languages the form has.
    lang = params.get('lang') || lang;
    if (!(form.languages || ['en']).includes(lang)) lang = 'en';
    DRI18N.setLang(lang);
    document.title = t(form.title) + ' | Dibiasio Realty';
    steps = [
      ...form.steps.map((s) => ({ ...s, kind: 'fields' })),
      { id: 'documents', title: 'Documents', kind: 'documents' },
      { id: 'review', title: 'Review', kind: 'review' },
      { id: 'sign', title: 'Sign & submit', kind: 'sign' },
    ];
    const draft = loadDraft();
    if (draft) {
      state.answers = draft.answers || {};
      renderResume(draft);
    } else {
      renderWelcome();
    }
  }

  function fatal(msg) {
    $app.innerHTML = '<div class="card"><h1>' + esc(t('Link not available')) + '</h1><p>' + esc(t(msg || 'Something went wrong.')) + '</p><a class="btn" href="/">' + esc(t('Go to the application page')) + '</a></div>';
  }

  function propertyBanner() {
    const p = deal && deal.property;
    const agent = deal && deal.agent;
    if (!p && !agent) return '';
    const addr = p && [p.address, p.unit && t('Unit {unit}', { unit: p.unit }), p.city].filter(Boolean).join(', ');
    const facts = p ? [p.rent && money(p.rent) + t('/mo'), p.moveIn && t('Move-in {date}', { date: DRUI.date(p.moveIn) })].filter(Boolean).join(' · ') : '';
    return '<div class="property"><div class="pin">' + (addr ? '⌂' : '✦') + '</div><div>' +
      (addr ? '<b>' + esc(addr) + '</b>' : '') +
      (facts ? '<span class="muted small">' + esc(facts) + '</span><br>' : '') +
      (agent ? '<span class="small">' + esc(t('Your agent:')) + ' <b style="display:inline">' + esc(agent.name) + '</b>' + (agent.phone ? ' · ' + esc(agent.phone) : '') + (agent.email ? ' · <a href="mailto:' + esc(agent.email) + '">' + esc(agent.email) + '</a>' : '') + '</span>' : '') +
      '</div></div>';
  }

  function checklist() {
    return '<ul class="small" style="margin:6px 0 0;padding-left:20px">' + form.documents.map((d) => '<li>' + esc(t(d.label)) + (d.req ? '' : ' <span class="muted">' + esc(t('(if applicable)')) + '</span>') + '</li>').join('') + '</ul>';
  }

  // Details for the "send the guarantor form" message.
  const guarantorContext = () => ({
    applicantName: state.answers.name || '',
    property: deal && deal.property ? [deal.property.address, deal.property.unit && t('Unit {unit}', { unit: deal.property.unit }), deal.property.city].filter(Boolean).join(', ') : '',
    agent: deal && deal.agent,
  });

  // "English | Português" switch for forms available in more than one language.
  function langSwitch() {
    const langs = form.languages || ['en'];
    if (langs.length < 2) return '';
    return '<div class="lang-switch" role="group" aria-label="Language / Idioma">' + langs.map((l) =>
      '<button type="button" class="btn small ' + (l === lang ? '' : 'ghost') + '" data-lang="' + l + '"' + (l === lang ? ' aria-pressed="true"' : '') + '>' + esc(DRI18N.LANGS[l]) + '</button>').join('') + '</div>';
  }
  function bindLangSwitch(rerender) {
    $app.querySelectorAll('[data-lang]').forEach((b) => b.onclick = () => {
      lang = DRI18N.setLang(b.dataset.lang);
      params.set('lang', lang);
      history.replaceState(null, '', location.pathname + '?' + params.toString());
      document.title = t(form.title) + ' | Dibiasio Realty';
      rerender();
    });
  }

  function renderWelcome() {
    $app.innerHTML = propertyBanner() + `
      <div class="card">
        ${langSwitch()}
        <span class="step-label">${esc(form.name)}</span>
        <h1>${esc(t(form.title))}</h1>
        <p class="muted">${esc(t(form.blurb))}</p>
        ${form.separateAdults ? '<div class="notice">Each adult who will live in the apartment fills out their own application. After you submit, you\'ll get a link to share with your roommates or co-applicants.</div>' : ''}
        <h3>${esc(t('Before you start, have these handy'))}</h3>
        ${checklist()}
        <p class="small muted" style="margin-top:12px">${esc(t('Takes about {n} minutes. You can take a photo of documents with your phone when you get to that step.', { n: form.minutes }))}</p>
        <div class="nav-row"><a class="btn secondary" href="/">${esc(t('Choose a different application'))}</a><button class="btn" id="start">${esc(t('Start application'))}</button></div>
      </div>` + DRGuarantor.html();
    DRGuarantor.bind($app, guarantorContext);
    bindLangSwitch(renderWelcome);
    document.getElementById('start').onclick = () => go(0);
  }

  function renderResume(draft) {
    $app.innerHTML = propertyBanner() + `
      <div class="card">
        ${langSwitch()}
        <h1>${esc(t('Welcome back'))}</h1>
        <p>${esc(t('You started a {title} on this device. Pick up where you left off?', { title: t(form.title) }))}</p>
        <p class="small muted">${esc(t('For your security, Social Security numbers and documents aren\'t saved between visits — you\'ll be asked for them again.'))}</p>
        <div class="nav-row"><button class="btn secondary" id="fresh">${esc(t('Start over'))}</button><button class="btn" id="resume">${esc(t('Continue'))}</button></div>
      </div>`;
    bindLangSwitch(() => renderResume(draft));
    document.getElementById('resume').onclick = () => go(Math.min(draft.stepIndex || 0, steps.length - 1));
    document.getElementById('fresh').onclick = () => { clearDraft(); state.answers = {}; go(0); };
  }

  /* ------------------------------- wizard ------------------------------- */
  let controller = null;

  function go(i) {
    stepIndex = i;
    saveDraft();
    const step = steps[i];
    const bar = '<div class="progress" aria-hidden="true">' + steps.map((s, j) => '<span class="' + (j < i ? 'done' : j === i ? 'now' : '') + '"></span>').join('') + '</div>';
    $app.innerHTML = propertyBanner() + '<div class="card"><span class="step-label">' + esc(t('Step {n} of {total}', { n: i + 1, total: steps.length })) + ' · ' + esc(t('{form} application', { form: form.short })) + '</span>' + bar +
      '<h1>' + esc(t(step.title)) + '</h1>' + (step.intro ? '<p class="muted">' + esc(t(step.intro)) + '</p>' : '') +
      '<div id="body"></div><div class="nav-row">' +
      (i > 0 ? '<button class="btn secondary" id="back">' + esc(t('Back')) + '</button>' : '<span></span>') +
      '<button class="btn" id="next">' + esc(t(step.kind === 'sign' ? 'Submit application' : 'Continue')) + '</button>' +
      '</div></div>';
    const body = document.getElementById('body');
    controller = null;
    if (step.kind === 'fields') controller = renderFields(body, step.fields, state.answers, { locked: deal && deal.prefill, onChange: saveDraft });
    if (step.kind === 'documents') renderDocuments(body);
    if (step.kind === 'review') renderReview(body);
    if (step.kind === 'sign') renderSign(body);
    const back = document.getElementById('back');
    if (back) back.onclick = () => go(i - 1);
    document.getElementById('next').onclick = () => next(step);
    window.scrollTo({ top: 0 });
  }

  function next(step) {
    if (controller && !controller.validate()) return;
    if (step.kind === 'sign') return submit();
    go(stepIndex + 1);
  }

  /* ----------------------------- documents ------------------------------ */
  function renderDocuments(body) {
    body.innerHTML = '<p class="muted">' + t('Upload a photo or PDF of each item. On a phone, tap <b>Add file</b> to take a picture. Files up to 20 MB each.') + '</p>' +
      form.documents.map((d) => `
      <div class="doc" data-doc="${d.id}">
        <div class="doc-head">
          <div><b>${esc(t(d.label))} ${d.req ? '<span class="pill warn">' + esc(t('Required')) + '</span>' : '<span class="pill">' + esc(t('If applicable')) + '</span>'}</b>
          ${d.help ? '<span class="small muted">' + esc(t(d.help)) + '</span>' : ''}${d.download ? '<br><a class="small" href="' + esc(d.download) + '" target="_blank" download>' + esc(t('⬇ Download the blank guarantor form (PDF)')) + '</a>' : ''}</div>
          <label class="btn secondary small">${esc(t('Add file'))}<input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.heic" class="hidden"></label>
        </div>
        <ul></ul>
      </div>`).join('') +
      '<div class="notice small">' + esc(t('Missing something? You can still submit — you\'ll get a private link to upload more documents later.')) + '</div>';

    body.querySelectorAll('.doc').forEach((box) => {
      const docType = box.dataset.doc;
      const input = box.querySelector('input');
      const draw = () => {
        const list = state.files[docType] || [];
        box.classList.toggle('done', list.length > 0);
        box.querySelector('ul').innerHTML = list.map((file, i) => '<li><span>' + (file.type.startsWith('image/') ? '🖼️' : '📄') + '</span><span class="name">' + esc(file.name) + '</span><span class="muted small">' + (file.size / 1048576).toFixed(1) + ' MB</span><button type="button" class="btn ghost small" data-i="' + i + '">' + esc(t('Remove')) + '</button></li>').join('');
        box.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { list.splice(Number(b.dataset.i), 1); draw(); });
      };
      const add = (fileList) => {
        const list = state.files[docType] = state.files[docType] || [];
        [...fileList].forEach((file) => {
          if (file.size > MAX_FILE) return alert(t('{name} is larger than 20 MB. Please upload a smaller file or a photo.', { name: file.name }));
          list.push(file);
        });
        draw();
      };
      input.onchange = () => { add(input.files); input.value = ''; };
      box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
      box.addEventListener('dragleave', () => box.classList.remove('drag'));
      box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag'); add(e.dataTransfer.files); });
      draw();
    });
  }

  /* ------------------------------- review ------------------------------- */
  function renderReview(body) {
    const missingDocs = form.documents.filter((d) => d.req && !(state.files[d.id] || []).length);
    const edit = esc(t('Edit'));
    body.innerHTML = '<p class="muted">' + t('Please check your answers. Tap <b>Edit</b> to change anything.') + '</p>' +
      form.steps.map((s, i) => '<div class="review-section"><div class="rs-head"><h3>' + esc(t(s.title)) + '</h3><button class="btn ghost small" data-edit="' + i + '">' + edit + '</button></div>' + summaryHtml(s.fields, state.answers, { skipBlank: true }) + '</div>').join('') +
      '<div class="review-section"><div class="rs-head"><h3>' + esc(t('Documents')) + '</h3><button class="btn ghost small" data-edit="' + form.steps.length + '">' + edit + '</button></div>' +
      '<dl class="kv">' + form.documents.map((d) => '<dt>' + esc(t(d.label)) + '</dt><dd>' + ((state.files[d.id] || []).length ? '<span class="pill ok">' + esc(t('{n} file(s)', { n: state.files[d.id].length })) + '</span>' : d.req ? '<span class="pill warn">' + esc(t('Not uploaded yet')) + '</span>' : '<span class="muted">—</span>') + '</dd>').join('') + '</dl>' +
      (missingDocs.length ? '<div class="notice warn small" style="margin-top:12px">' + esc(t('Your application may be delayed until we receive: {docs}. You can upload them later from your confirmation link.', { docs: missingDocs.map((d) => t(d.label)).join(', ') })) + '</div>' : '') +
      '</div>';
    body.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => go(Number(b.dataset.edit)));
  }

  /* -------------------------------- sign -------------------------------- */
  function adultsToSign() {
    if (!form.otherAdultSignatures) return [];
    const members = (state.answers.members || []).slice(1);
    return members.filter((m) => {
      if (!m.dob) return true;
      const age = (Date.now() - new Date(m.dob).getTime()) / (365.25 * 864e5);
      return age >= 18;
    }).map((m) => m.fullName).filter(Boolean);
  }

  function renderSign(body) {
    const others = adultsToSign();
    state.otherSigners = others.map((member) => (state.otherSigners.find((s) => s.member === member) || { member, name: '' }));
    body.innerHTML =
      (form.authorization ? '<h3>Authorization to release information</h3><div class="legal">' + esc(form.authorization) + '</div>' : '') +
      '<h3>' + esc(t('Certification')) + '</h3><div class="legal">' + esc(t(form.certification)) + '</div>' +
      '<label class="consent"><input type="checkbox" id="c-terms"' + (state.consents.terms ? ' checked' : '') + '><span>' + esc(t('I have read the statements above, I agree to them, and everything in this application is true and complete.')) + '</span></label>' +
      '<label class="consent"><input type="checkbox" id="c-credit"' + (state.consents.credit ? ' checked' : '') + '><span>' + esc(t('I authorize Dibiasio Realty, the landlord/management company, and their screening provider to obtain my consumer credit report' + (form.id === 'beantown' ? ' and a Criminal Offender Record Information (CORI) report' : '') + ' and to verify the information in this application, including with my landlords and employers.')) + '</span></label>' +
      '<label class="consent"><input type="checkbox" id="c-esign"' + (state.consents.esign ? ' checked' : '') + '><span>' + esc(t('I agree to sign this application electronically, and my electronic signature is as valid as a handwritten one.')) + '</span></label>' +
      '<div class="grid" style="margin-top:16px"><div class="fld"><label class="lbl" for="sig-name">' + esc(t('Type your full legal name')) + '<span class="req">*</span></label><input id="sig-name" autocomplete="name" value="' + esc(state.signature.typedName || state.answers.name || '') + '"></div>' +
      '<div class="fld"><label class="lbl">' + esc(t('Sign below with your finger or mouse')) + '<span class="req">*</span></label><canvas class="sig-pad" id="sig-pad" aria-label="' + esc(t('Signature pad')) + '"></canvas><div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px"><span class="help">' + esc(t('Date: {date}', { date: new Date().toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US') })) + '</span><button type="button" class="btn ghost small" id="sig-clear">' + esc(t('Clear signature')) + '</button></div></div>' +
      (others.length ? '<div class="section-head"><h3>' + esc(t('Other adults on this application')) + '</h3><p>' + esc(t('Each adult (18+) types their full name to sign.')) + '</p></div>' + others.map((m, i) => '<div class="fld half"><label class="lbl" for="os-' + i + '">' + esc(m) + '</label><input id="os-' + i + '" data-os="' + i + '" placeholder="' + esc(t('Type full name to sign')) + '" value="' + esc(state.otherSigners[i].name) + '"></div>').join('') : '') +
      '</div><div id="sign-error" class="notice bad hidden" style="margin-top:14px"></div>';

    ['terms', 'credit', 'esign'].forEach((k) => document.getElementById('c-' + k).onchange = (e) => { state.consents[k] = e.target.checked; });
    document.getElementById('sig-name').oninput = (e) => { state.signature.typedName = e.target.value; };
    state.signature.typedName = document.getElementById('sig-name').value;
    body.querySelectorAll('[data-os]').forEach((inp) => inp.oninput = () => { state.otherSigners[Number(inp.dataset.os)].name = inp.value; });
    signaturePad(document.getElementById('sig-pad'));
  }

  function signaturePad(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d2e5a';
    const restore = () => {
      if (!state.signature.image) return;
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = state.signature.image;
    };
    restore();
    let drawing = false, strokes = 0;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); strokes++; });
    const end = () => { if (!drawing) return; drawing = false; if (strokes > 3) state.signature.image = canvas.toDataURL('image/png'); };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    document.getElementById('sig-clear').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); state.signature.image = ''; strokes = 0; };
  }

  /* ------------------------------- submit ------------------------------- */
  function signError(msg) {
    const el = document.getElementById('sign-error');
    el.innerHTML = msg;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function submit() {
    const problems = [];
    if (!state.consents.terms) problems.push(t('check the box agreeing to the certification'));
    if (!state.consents.credit) problems.push(t('authorize the credit check'));
    if (!state.consents.esign) problems.push(t('agree to sign electronically'));
    if (!state.signature.typedName.trim()) problems.push(t('type your full name'));
    if (!state.signature.image) problems.push(t('sign in the signature box'));
    if (problems.length) return signError(esc(t('Please {list}.', { list: problems.join(', ') })));

    // Make sure every earlier step is complete (e.g. a resumed draft is missing the SSN).
    const incomplete = form.steps.findIndex((s) => !DRUI.isComplete(s.fields, state.answers, deal && deal.prefill));
    if (incomplete >= 0) { go(incomplete); controller.validate(); return; }

    const fd = new FormData();
    fd.append('payload', JSON.stringify({
      form: form.id, dealToken, agentId, lang, answers: state.answers, signature: state.signature,
      otherSigners: state.otherSigners, consents: state.consents,
    }));
    Object.entries(state.files).forEach(([docType, list]) => list.forEach((file) => fd.append('doc_' + docType, file, file.name)));

    const overlay = document.getElementById('overlay');
    const bar = document.getElementById('overlay-bar');
    overlay.classList.remove('hidden');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/public/applications');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    xhr.onload = () => {
      overlay.classList.add('hidden');
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) { clearDraft(); return renderSuccess(body); }
      signError(esc(t(body.error || 'We couldn\'t submit your application. Please try again.')) + (body.missing ? '<br><span class="small">' + body.missing.map((m) => esc(t(m))).join(', ') + '</span>' : ''));
    };
    xhr.onerror = () => { overlay.classList.add('hidden'); signError(esc(t('Connection problem — please check your internet connection and try again. Your answers are still here.'))); };
    xhr.send(fd);
  }

  function renderSuccess(res) {
    document.getElementById('saved-note').textContent = '';
    const credit = res.creditScreeningUrl;
    $app.innerHTML = `
      <div class="card">
        <div class="success-icon">✓</div>
        <h1>${esc(t('Application submitted!'))}</h1>
        <p>${esc(state.answers.name ? t('Thank you, {name}. Your agent has been notified and will be in touch about next steps.', { name: state.answers.name.split(' ')[0] }) : t('Thank you. Your agent has been notified and will be in touch about next steps.'))}</p>
        <p class="muted">${esc(t('Confirmation #:'))} <b>${esc(res.confirmation)}</b></p>
      </div>
      ${credit ? `<div class="card"><h2>${esc(t('Next: complete your credit check'))}</h2>
        <p class="muted">${esc(t('The landlord requires a credit report. It\'s completed securely through {provider} and only takes a few minutes.', { provider: config.creditProvider || t('our screening partner') }))}</p>
        <a class="btn" href="${esc(credit)}" target="_blank" rel="noopener">${esc(t('Start credit check'))}</a></div>` : ''}
      <div class="card"><h2>${esc(t('Need to add documents later?'))}</h2>
        <p class="muted">${esc(t('Save this private link. You can use it any time to upload pay stubs, ID or anything else your agent asks for.'))}</p>
        <div class="copy-row"><input class="input" readonly value="${esc(res.statusUrl)}" id="status-url"><button class="btn secondary" data-copy="status-url">${esc(t('Copy'))}</button></div>
        <p style="margin-top:12px"><a href="${esc(res.statusUrl)}">${esc(t('Open my upload page'))}</a></p></div>
      <div class="card"><h2>${esc(t('Applying with roommates?'))}</h2>
        <p class="muted">${form.separateAdults ? esc(t('Each adult needs to file their own application.')) + ' ' : ''}${esc(t('Share this link so co-applicants are added to the same apartment application.'))}</p>
        <div class="copy-row"><input class="input" readonly value="${esc(res.coApplicantUrl)}" id="co-url"><button class="btn secondary" data-copy="co-url">${esc(t('Copy'))}</button></div></div>` + DRGuarantor.html();
    DRGuarantor.bind($app, guarantorContext);
    $app.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
      const input = document.getElementById(b.dataset.copy);
      input.select();
      (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject()).catch(() => document.execCommand('copy'));
      b.textContent = t('Copied!');
      setTimeout(() => (b.textContent = t('Copy')), 1500);
    });
    window.scrollTo({ top: 0 });
  }

  init();
})();
