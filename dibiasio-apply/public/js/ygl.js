// Credit checks through YouGotListings. YGL has no API for credit reports, so
// the dashboard prepares each adult's details and a bookmarklet fills YGL's
// "create credit report" form from them. Data travels via the clipboard with a
// "DRCREDIT:" prefix and a timestamp; the bookmarklet clears it after filling.
(function (root) {
  const { esc } = DRUI;
  const YGL_URL = 'https://app.yougotlistings.com/credit-reports/create';
  const PREFIX = 'DRCREDIT:';

  // "12A Lexington St, Apt 2" → { number: '12A', name: 'Lexington St', unit: 'Apt 2' }
  function splitStreet(street) {
    let s = String(street || '').trim();
    let unit = '';
    const u = s.match(/^(.*?)(?:,\s*|\s+)((?:apt|apartment|unit|ste|suite|#|fl|floor)\b.*|#.*)$/i);
    if (u) { s = u[1].trim(); unit = u[2].trim(); }
    const n = s.match(/^(\d+[A-Za-z]?(?:\s*-\s*\d+[A-Za-z]?)?)\s+(.+)$/);
    return n ? { number: n[1].replace(/\s+/g, ''), name: n[2], unit } : { number: '', name: s, unit };
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { first: parts[0] || '', last: '' };
    // Keep suffixes with the last name ("Smith Jr").
    const suffix = /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1]) && parts.length > 2 ? ' ' + parts.pop() : '';
    return { first: parts[0], last: parts[parts.length - 1] + suffix };
  }

  const adult = (dob) => {
    if (!dob) return true;
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 864e5);
    return !(age < 18);
  };

  // Every adult on an application, with the fields YGL asks for.
  function people(formId, answers) {
    const a = answers || {};
    const street = splitStreet(a.curStreet);
    const address = { streetNumber: street.number, streetName: street.name, unit: street.unit, city: a.curCity || '', state: a.curState || '', zip: a.curZip || '' };
    const list = formId === 'beantown'
      ? (a.members || []).filter((m) => m.fullName && adult(m.dob)).map((m, i) => ({ who: i === 0 ? 'Head of household' : (m.relationship || 'Household member'), fullName: m.fullName, ssn: m.ssn || '' }))
      : [{ who: 'Applicant', fullName: a.name, ssn: a.ssn || '' }];
    return list.map((p) => ({ ...p, ...splitName(p.fullName), ...address }));
  }

  const FIELDS = [['first', 'First name'], ['last', 'Last name'], ['ssn', 'SSN'], ['streetNumber', 'Street number'], ['streetName', 'Street name'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP code']];

  /* ----------------------------- dashboard ----------------------------- */
  function open({ formId, answers, applicantName, onCopied, copy, toast }) {
    const list = people(formId, answers);
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="box" style="text-align:left;width:min(760px,100%);max-height:92vh;overflow:auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><h3 style="margin:0">Credit check on YouGotListings</h3>
        <p class="small muted" style="margin:4px 0 0">${esc(applicantName)}'s application · ${list.length} adult${list.length === 1 ? '' : 's'}. Check the details, then click <b>Copy &amp; open YGL</b> and use your <b>Fill from Dibiasio</b> bookmark on YGL's page.</p></div>
        <button class="btn ghost small" data-close>Close</button></div>
      ${list.length ? '' : '<div class="notice warn" style="margin-top:12px">No adults with a name were found on this application.</div>'}
      ${list.map((p, i) => `<div class="subcard" data-person="${i}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h4 style="margin:0">${esc(p.fullName)} <span class="muted small">· ${esc(p.who)}</span></h4>
          <button class="btn small" data-go>Copy &amp; open YGL</button></div>
        ${!p.ssn ? '<div class="notice warn small" style="margin:8px 0 0">No SSN on the application. Ask the applicant before running the report.</div>' : ''}
        ${p.unit ? '<div class="small muted" style="margin-top:6px">Unit from their address: <b>' + esc(p.unit) + '</b> (enter it on YGL if there\'s a unit field)</div>' : ''}
        <div class="grid" style="margin-top:10px">${FIELDS.map(([k, label]) => `<div class="fld ${k === 'streetName' ? 'half' : 'quarter'}"><label class="lbl">${label}</label>
          <div class="copy-row"><input class="input" data-k="${k}" value="${esc(p[k])}"${k === 'ssn' ? ' type="password" autocomplete="off"' : ''}><button class="btn ghost small" data-copy-field="${k}" title="Copy">⧉</button></div></div>`).join('')}</div>
      </div>`).join('')}
      <p class="small muted" style="margin-top:12px">First time? Add the <b>Fill from Dibiasio</b> bookmark from the <a href="#agents" data-close>Team</a> page.</p>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('[data-person]').forEach((card) => {
      const values = () => Object.fromEntries(FIELDS.map(([k]) => [k, card.querySelector('[data-k="' + k + '"]').value.trim()]));
      card.querySelectorAll('[data-copy-field]').forEach((b) => b.onclick = () => copy(card.querySelector('[data-k="' + b.dataset.copyField + '"]').value, FIELDS.find(([k]) => k === b.dataset.copyField)[1]));
      card.querySelector('[data-go]').onclick = async () => {
        const payload = PREFIX + JSON.stringify({ ...values(), t: Date.now() });
        try { await navigator.clipboard.writeText(payload); } catch (e) { prompt('Copy this, then use the Fill from Dibiasio bookmark on YGL:', payload); }
        window.open(YGL_URL, '_blank', 'noopener');
        toast('Copied. Click your "Fill from Dibiasio" bookmark on the YGL page');
        if (onCopied) onCopied();
      };
    });
  }

  /* ----------------------------- bookmarklet ---------------------------- */
  // Runs on app.yougotlistings.com. Matches fields by their name, id,
  // placeholder and label text, so it keeps working if YGL tweaks its layout.
  function fill() {
    (async () => {
      const PFX = 'DRCREDIT:';
      let t = '';
      try { t = await navigator.clipboard.readText(); } catch (e) { /* permission denied: fall back to paste */ }
      if (!t || t.indexOf(PFX) !== 0) t = prompt('Paste the credit-check details copied from the Dibiasio dashboard:') || '';
      if (t.indexOf(PFX) !== 0) { alert('No Dibiasio credit-check details found. Click "Copy & open YGL" in the dashboard first.'); return; }
      const d = JSON.parse(t.slice(PFX.length));
      if (Date.now() - d.t > 15 * 60e3) { alert('Those details are over 15 minutes old. Copy them again from the dashboard.'); return; }
      const fields = [...document.querySelectorAll('input, select')].filter((e) => !/^(hidden|submit|button|checkbox|radio|file)$/i.test(e.type) && e.offsetParent !== null);
      const text = (e) => {
        const byFor = e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]');
        const wrap = e.closest('label');
        const near = e.parentElement && e.parentElement.closest('div') && e.parentElement.closest('div').querySelector('label');
        return [e.name, e.id, e.placeholder, e.getAttribute('aria-label'), byFor && byFor.textContent, wrap && wrap.textContent, near && near.textContent].join(' ').toLowerCase();
      };
      const set = (el, v) => {
        if (el.tagName === 'SELECT') {
          const o = [...el.options].find((x) => x.value.toUpperCase() === v.toUpperCase() || x.text.trim().toUpperCase() === v.toUpperCase() || x.text.trim().toUpperCase().indexOf(v.toUpperCase() + ' ') === 0);
          if (!o) return false;
          el.value = o.value;
        } else {
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        el.style.outline = '2px solid #1d7a4d';
        return true;
      };
      const used = new Set();
      const find = (re) => fields.find((e) => !used.has(e) && re.test(text(e)));
      const missed = [];
      // SSN may be one box or three (3-2-4).
      const ssnBoxes = fields.filter((e) => /ssn|social/.test(text(e)));
      const digits = String(d.ssn || '').replace(/\D/g, '');
      if (digits && ssnBoxes.length >= 3) {
        [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5)].forEach((v, i) => { set(ssnBoxes[i], v); used.add(ssnBoxes[i]); });
      } else if (digits && ssnBoxes[0]) {
        set(ssnBoxes[0], d.ssn); used.add(ssnBoxes[0]);
      } else if (digits) missed.push('SSN');
      const rules = [
        ['first', 'First name', /first/],
        ['last', 'Last name', /last|surname/],
        ['streetNumber', 'Street number', /(street|house|address|addr)[\s_-]*(number|num|no\b|#)|^\s*(number|no\.?)\s*$/],
        ['streetName', 'Street name', /street[\s_-]*name|street(?![\s_-]*(number|num|no\b))|address/],
        ['city', 'City', /city|town/],
        ['state', 'State', /state|province/],
        ['zip', 'ZIP', /zip|postal/],
      ];
      for (const [k, label, re] of rules) {
        if (!d[k]) continue;
        const el = find(re);
        if (!el || !set(el, d[k])) { missed.push(label); continue; }
        used.add(el);
      }
      try { await navigator.clipboard.writeText(''); } catch (e) { /* ignore */ }
      alert(missed.length ? 'Filled what matched for ' + d.first + ' ' + d.last + '. Please fill in: ' + missed.join(', ') + '.' : 'Filled ' + d.first + ' ' + d.last + '. Review the highlighted fields, then submit.');
    })();
  }

  const bookmarklet = () => 'javascript:' + encodeURIComponent('(' + fill.toString() + ')()');

  root.DRYGL = { open, people, splitStreet, splitName, bookmarklet, YGL_URL };
})(this);
