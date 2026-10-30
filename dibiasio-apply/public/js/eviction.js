// Eviction & court-record checks. Massachusetts eviction ("summary process") and
// civil cases are public on MassCourts, but its search is behind a CAPTCHA and
// has no API, so the agent runs the search: this lists each adult with what's
// needed to match records, opens MassCourts with the name ready for the "Fill
// from Dibiasio" bookmark (see ygl.js), and records what was found.
(function (root) {
  const { esc } = DRUI;
  const MASSCOURTS_URL = 'https://www.masscourts.org/eservices/home.page';
  const PREFIX = 'DRCREDIT:';

  const STATUSES = ['Not checked', 'No records found', 'Records found', 'Waived'];
  const CASE_TYPES = ['Eviction (summary process)', 'Small claims', 'Civil', 'Other'];
  const OUTCOMES = ['Open / pending', 'Dismissed', 'Judgment for tenant', 'Agreement / settled', 'Judgment for landlord', 'Execution issued', 'Unknown'];

  // Every adult on the application, with what helps tell them apart from someone
  // else with the same name.
  function subjects(formId, answers) {
    const a = answers || {};
    const where = (p) => [a[p + 'Street'], a[p + 'City'], a[p + 'State'], a[p + 'Zip']].filter(Boolean).join(', ');
    const addresses = [where('cur'), where('prev')].filter(Boolean);
    return DRYGL.people(formId, a).map((p, i) => ({
      who: p.who, fullName: p.fullName, first: p.first, last: p.last,
      dob: formId === 'beantown' ? ((a.members || []).find((m) => m.fullName === p.fullName) || {}).dob || '' : a.dob || '',
      addresses,
      // What the applicant said on the form, to compare with what's found.
      selfReport: i === 0 && a.evicted ? 'Answered "' + a.evicted + '" to "Ever evicted or served a Notice to Quit?"' : '',
    }));
  }

  // One-line result for the applicant card and the deal.
  function summary(ev) {
    if (!ev || !ev.status || ev.status === 'Not checked') return 'Not checked';
    const cases = ev.cases || [];
    if (!cases.length) return ev.status;
    const evictions = cases.filter((c) => /^Eviction/.test(c.type));
    const against = evictions.filter((c) => /landlord|Execution/.test(c.outcome)).length;
    const open = cases.filter((c) => /^Open/.test(c.outcome)).length;
    return cases.length + ' case' + (cases.length > 1 ? 's' : '') + ' found' +
      (evictions.length ? ' · ' + evictions.length + ' eviction' + (evictions.length > 1 ? 's' : '') : '') +
      (against ? ' · ' + against + ' judgment' + (against > 1 ? 's' : '') + ' for landlord' : '') + (open ? ' · ' + open + ' open' : '');
  }

  const select = (attr, options, value) => '<select class="input" ' + attr + '>' + options.map((o) => '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';

  function open({ formId, answers, applicantName, eviction, copy, toast, onSave }) {
    const people = subjects(formId, answers);
    const ev = JSON.parse(JSON.stringify(eviction || { status: 'Not checked', cases: [], notes: '' }));
    ev.cases = ev.cases || [];
    const names = people.map((p) => p.fullName);
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="box" style="text-align:left;width:min(860px,100%);max-height:92vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3 style="margin:0">Eviction &amp; court records check</h3>
        <p class="small muted" style="margin:4px 0 0">${esc(applicantName)}'s application · ${people.length} adult${people.length === 1 ? '' : 's'}</p></div>
        <button class="btn ghost small" data-close>Close</button></div>
      <details class="small" style="margin-top:10px"><summary><b>How to search</b></summary><ol style="margin:6px 0 0;padding-left:20px">
        <li>Click <b>Search MassCourts</b>, pass the "I'm not a robot" check, and choose a search by <b>name</b>.</li>
        <li>Click your <b>Fill from Dibiasio</b> bookmark to fill the name. Search the <b>Housing Court</b> and the <b>District Court / Boston Municipal Court</b> (evictions are "Summary Process" cases), plus Superior Court for other civil cases.</li>
        <li>Only record a case if the date of birth or an address confirms it's the same person.</li>
        <li>Record the outcome. A case that was dismissed or won by the tenant is not an eviction. Sealed cases don't appear, and applicants can lawfully say they have no record of them.</li>
        <li>Lived out of state? Search that state's court website too.</li></ol></details>
      ${people.map((p, i) => `<div class="subcard" data-person="${i}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h4 style="margin:0">${esc(p.fullName)} <span class="muted small">· ${esc(p.who)}</span></h4>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn small" data-go>Search MassCourts</button><button class="btn ghost small" data-copy-last>Copy last name</button><button class="btn ghost small" data-copy-first>Copy first name</button></div></div>
        <dl class="kv small" style="margin-top:8px"><dt>Last, first</dt><dd>${esc(p.last)}, ${esc(p.first)}</dd>
          <dt>Date of birth</dt><dd>${p.dob ? esc(DRUI.date(p.dob)) : '<span class="muted">not given</span>'}</dd>
          <dt>Addresses</dt><dd>${p.addresses.map(esc).join('<br>') || '<span class="muted">—</span>'}</dd>
          ${p.selfReport ? '<dt>On the application</dt><dd>' + esc(p.selfReport) + '</dd>' : ''}</dl>
      </div>`).join('')}
      <h4 style="margin:18px 0 6px">Result</h4>
      <div class="inline-form">${select('data-ev-status', STATUSES, ev.status)}<span class="small muted" data-ev-checked>${ev.checkedAt ? 'Last saved ' + new Date(ev.checkedAt).toLocaleString() + ' by ' + esc(ev.by || '') : ''}</span></div>
      <div data-cases style="margin-top:8px"></div>
      <button class="btn secondary small" data-add-case style="margin-top:8px">+ Add a case found</button>
      <label class="lbl" style="display:block;margin-top:14px" for="ev-notes">Notes</label>
      <textarea class="input" id="ev-notes" rows="2" style="resize:vertical" placeholder="e.g. Searched Housing and District Court, no matches with this DOB">${esc(ev.notes || '')}</textarea>
      <p class="small muted" style="margin:8px 0 0">Attach the docket printout with <b>Upload printout</b> on the applicant's card. It stays out of the landlord package unless you tick it.</p>
      <div class="nav-row"><button class="btn secondary" data-close>Cancel</button><button class="btn" data-save>Save result</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

    overlay.querySelectorAll('[data-person]').forEach((card) => {
      const p = people[Number(card.dataset.person)];
      card.querySelector('[data-copy-last]').onclick = () => copy(p.last, 'Last name');
      card.querySelector('[data-copy-first]').onclick = () => copy(p.first, 'First name');
      card.querySelector('[data-go]').onclick = async () => {
        // Name only: SSNs never go to court searches.
        const payload = PREFIX + JSON.stringify({ first: p.first, last: p.last, t: Date.now() });
        try { await navigator.clipboard.writeText(payload); } catch (e) { /* the bookmark asks them to paste instead */ }
        window.open(MASSCOURTS_URL, '_blank', 'noopener');
        toast('Opened MassCourts. Pick a name search, then click your "Fill from Dibiasio" bookmark');
      };
    });

    const box = overlay.querySelector('[data-cases]');
    const draw = () => {
      box.innerHTML = ev.cases.length ? ev.cases.map((c, i) => `<div class="subcard" data-case="${i}" style="margin-top:8px">
        <div class="grid">
          <div class="fld third"><label class="lbl">Person</label>${select('data-k="person"', names.length ? names : [''], c.person)}</div>
          <div class="fld third"><label class="lbl">Type</label>${select('data-k="type"', CASE_TYPES, c.type)}</div>
          <div class="fld third"><label class="lbl">Outcome</label>${select('data-k="outcome"', OUTCOMES, c.outcome)}</div>
          <div class="fld third"><label class="lbl">Court</label><input class="input" data-k="court" value="${esc(c.court || '')}" placeholder="e.g. Eastern Housing Court"></div>
          <div class="fld third"><label class="lbl">Case #</label><input class="input" data-k="caseNo" value="${esc(c.caseNo || '')}" placeholder="e.g. 24H84SP001234"></div>
          <div class="fld third"><label class="lbl">Filed</label><input class="input" type="date" data-k="filed" value="${esc(c.filed || '')}"></div>
          <div class="fld"><label class="lbl">Details</label><input class="input" data-k="notes" value="${esc(c.notes || '')}" placeholder="Plaintiff, amount, how the match was confirmed (DOB / address)"></div>
        </div><button class="btn ghost small" data-remove>Remove</button></div>`).join('') : '<p class="small muted" style="margin:0">No cases recorded.</p>';
      box.querySelectorAll('[data-case]').forEach((row) => {
        const c = ev.cases[Number(row.dataset.case)];
        row.querySelectorAll('[data-k]').forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { c[el.dataset.k] = el.value; }));
        row.querySelector('[data-remove]').onclick = () => { ev.cases.splice(Number(row.dataset.case), 1); draw(); };
      });
    };
    draw();
    const status = overlay.querySelector('[data-ev-status]');
    overlay.querySelector('[data-add-case]').onclick = () => {
      ev.cases.push({ person: names[0] || '', type: CASE_TYPES[0], outcome: OUTCOMES[0], court: '', caseNo: '', filed: '', notes: '' });
      if (status.value === 'Not checked' || status.value === 'No records found') status.value = 'Records found';
      draw();
    };
    overlay.querySelector('[data-save]').onclick = async () => {
      ev.status = status.value;
      ev.notes = overlay.querySelector('#ev-notes').value;
      if (ev.status === 'No records found' && ev.cases.length && !confirm('You recorded cases but chose "No records found". Save anyway?')) return;
      try { await onSave({ status: ev.status, cases: ev.cases, notes: ev.notes }); close(); } catch (e) { toast(e.message); }
    };
  }

  root.DREviction = { open, subjects, summary, STATUSES, CASE_TYPES, OUTCOMES, MASSCOURTS_URL };
})(this);
