// Turns the field definitions in forms.js into live, two-way bound form controls,
// and renders read-only summaries for review, the agent dashboard and print.
(function (root) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blank = (v) => v == null || String(v).trim() === '';
  // A saved SSN shown back as "•••-••-6789" (see /api/public/edit); kept unless retyped.
  const masked = (v) => String(v || '').includes('•');
  const ssnOk = (v) => masked(v) || String(v).replace(/\D/g, '').length === 9;
  let uid = 0;

  function money(v) {
    if (blank(v)) return '';
    const n = DR.num(v);
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function date(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return v || '';
    const [y, m, d] = v.split('-');
    return m + '/' + d + '/' + y;
  }
  function maskSsn(v) {
    const d = String(v || '').replace(/\D/g, '');
    return d ? '•••-••-' + d.slice(-4) : '';
  }
  function display(field, v, opts = {}) {
    if (blank(v)) return '';
    if (field.type === 'money') return money(v);
    if (field.type === 'date') return date(v);
    if (field.type === 'ssn' && !opts.revealSsn) return maskSsn(v);
    return String(v);
  }
  function formatSsn(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 9);
    if (d.length > 5) return d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5);
    if (d.length > 3) return d.slice(0, 3) + '-' + d.slice(3);
    return d;
  }
  function formatPhone(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length === 11 && d[0] === '1') return '+1 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
    return v;
  }

  /**
   * Render editable fields into `container`, bound to `scope` (mutated in place).
   * opts.locked: { dealKey: value } — prefilled fields shown read-only
   * opts.onChange(): called after any edit
   * Returns a controller with validate().
   */
  function renderFields(container, fields, scope, opts = {}) {
    const registry = [];
    container.innerHTML = '';
    container.classList.add('grid');

    const refreshVisibility = () => {
      registry.forEach((r) => {
        if (!r.field.showIf) return;
        const show = r.scope[r.field.showIf.k] === r.field.showIf.eq;
        r.el.classList.toggle('hidden', !show);
      });
    };
    const changed = () => { refreshVisibility(); opts.onChange && opts.onChange(); };

    const build = (parent, list, sc, ctx) => {
      list.forEach((field) => {
        if (field.type === 'heading') {
          const h = document.createElement('div');
          h.className = 'section-head';
          h.innerHTML = '<h3>' + esc(field.label) + '</h3>' + (field.help ? '<p>' + esc(field.help) + '</p>' : '');
          parent.appendChild(h);
          return;
        }
        if (field.type === 'note') {
          const n = document.createElement('div');
          n.className = 'fld notice';
          n.textContent = field.label;
          parent.appendChild(n);
          return;
        }
        if (field.type === 'group') return buildGroup(parent, field, sc);
        if (field.hideFirst && ctx && ctx.index === 0) return;

        const id = 'f' + (++uid);
        const el = document.createElement('div');
        el.className = 'fld ' + (field.w || '');
        const lockedVal = field.deal && opts.locked && opts.locked[field.deal];
        if (lockedVal) sc[field.k] = lockedVal;
        const v = sc[field.k] == null ? '' : sc[field.k];
        const reqMark = field.req ? '<span class="req" aria-hidden="true">*</span>' : '';
        const attrs = (field.placeholder ? ' placeholder="' + esc(field.placeholder) + '"' : '') +
          (field.maxlength ? ' maxlength="' + field.maxlength + '"' : '') +
          (field.inputmode ? ' inputmode="' + field.inputmode + '"' : '') +
          (field.autocomplete ? ' autocomplete="' + field.autocomplete + '"' : '') +
          (field.req ? ' aria-required="true"' : '') + (lockedVal ? ' readonly' : '');
        let control;
        switch (field.type) {
          case 'textarea':
            control = '<textarea id="' + id + '"' + attrs + '>' + esc(v) + '</textarea>';
            break;
          case 'select':
          case 'state': {
            const options = field.type === 'state' ? DR.STATES : field.options;
            control = '<select id="' + id + '"' + (lockedVal ? ' disabled' : '') + '><option value="">Select…</option>' +
              options.map((o) => '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') + '</select>';
            break;
          }
          case 'yesno':
          case 'radio': {
            const options = field.type === 'yesno' ? ['Yes', 'No'] : field.options;
            control = '<div class="options" role="radiogroup" aria-labelledby="' + id + '-l">' + options.map((o) =>
              '<label><input type="radio" name="' + id + '" value="' + esc(o) + '"' + (o === v ? ' checked' : '') + (lockedVal ? ' disabled' : '') + '>' + esc(o) + '</label>').join('') + '</div>';
            break;
          }
          case 'ssn':
            control = '<div class="ssn-wrap"><input id="' + id + '" type="password" inputmode="numeric" autocomplete="off" placeholder="###-##-####" maxlength="11" value="' + esc(v) + '"' + attrs + '>' +
              '<button type="button" class="btn ghost small" data-toggle>Show</button></div>';
            break;
          default: {
            const type = { email: 'email', tel: 'tel', date: 'date', number: 'number' }[field.type] || 'text';
            const extra = field.type === 'money' ? ' inputmode="decimal" placeholder="$0.00"' : '';
            control = '<input id="' + id + '" type="' + type + '" value="' + esc(v) + '"' + extra + attrs + '>';
          }
        }
        el.innerHTML = '<label class="lbl" id="' + id + '-l" for="' + id + '">' + esc(field.label) + reqMark + '</label>' + control +
          (lockedVal ? '<div class="help">Filled in by your agent.</div>' : masked(v) ? '<div class="help">Saved and hidden for your security. Leave it to keep it, or tap to type a new one.</div>' : field.help ? '<div class="help">' + esc(field.help) + '</div>' : '') +
          '<div class="err" role="alert"></div>';
        parent.appendChild(el);

        const set = (val) => { sc[field.k] = val; el.classList.remove('error'); changed(); };
        if (field.type === 'yesno' || field.type === 'radio') {
          el.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => set(i.value)));
        } else {
          const input = el.querySelector('#' + id);
          input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
            if (field.type === 'ssn') input.value = formatSsn(input.value);
            set(input.value);
          });
          if (field.type === 'tel') input.addEventListener('blur', () => { input.value = formatPhone(input.value); set(input.value); });
          if (masked(v)) {
            // Clear the hidden number when they start typing; put it back if they leave it empty.
            input.addEventListener('focus', () => { if (masked(input.value)) { input.value = ''; set(''); } });
            input.addEventListener('blur', () => { if (!input.value) { input.value = v; set(v); } });
          }
          const toggle = el.querySelector('[data-toggle]');
          if (toggle) toggle.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            toggle.textContent = show ? 'Hide' : 'Show';
          });
        }
        registry.push({ field, scope: sc, el });
      });
    };

    const buildGroup = (parent, field, sc) => {
      if (!Array.isArray(sc[field.k])) sc[field.k] = [];
      const items = sc[field.k];
      while (items.length < (field.min || 0)) items.push({});
      const box = document.createElement('div');
      box.className = 'fld';
      box.style.display = 'grid';
      box.style.gap = '14px';
      parent.appendChild(box);
      const draw = () => {
        // Drop registry entries belonging to this group before rebuilding it.
        for (let i = registry.length - 1; i >= 0; i--) if (box.contains(registry[i].el)) registry.splice(i, 1);
        box.innerHTML = '';
        items.forEach((item, index) => {
          const card = document.createElement('div');
          card.className = 'group-item';
          card.innerHTML = '<div class="gi-head"><h4>' + esc(field.itemLabel(index)) + '</h4>' +
            (items.length > (field.min || 0) ? '<button type="button" class="btn ghost small" data-remove>Remove</button>' : '') + '</div>';
          const grid = document.createElement('div');
          grid.className = 'grid';
          card.appendChild(grid);
          build(grid, field.fields, item, { index });
          const rm = card.querySelector('[data-remove]');
          if (rm) rm.addEventListener('click', () => { items.splice(index, 1); draw(); changed(); });
          box.appendChild(card);
        });
        if (items.length < field.max) {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'btn secondary';
          add.textContent = '+ ' + field.addLabel;
          add.addEventListener('click', () => { items.push({}); draw(); changed(); });
          box.appendChild(add);
        }
        refreshVisibility();
      };
      draw();
    };

    build(container, fields, scope);
    refreshVisibility();

    return {
      validate() {
        let first = null;
        registry.forEach(({ field, scope: sc, el }) => {
          if (el.classList.contains('hidden') || !document.body.contains(el)) return;
          const v = sc[field.k];
          let msg = '';
          if (field.req && blank(v)) msg = 'This is required.';
          else if (!blank(v) && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Enter a valid email address.';
          else if (!blank(v) && field.type === 'ssn' && !ssnOk(v)) msg = 'Enter all 9 digits.';
          else if (!blank(v) && field.type === 'tel' && String(v).replace(/\D/g, '').length < 10) msg = 'Enter a full phone number.';
          el.classList.toggle('error', !!msg);
          el.querySelector('.err').textContent = msg;
          if (msg && !first) first = el;
        });
        if (first) {
          first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const input = first.querySelector('input, select, textarea');
          if (input) setTimeout(() => input.focus({ preventScroll: true }), 300);
        }
        return !first;
      },
    };
  }

  // DOM-free check that every visible required field in `fields` has a valid answer.
  function isComplete(fields, scope, locked) {
    return fields.every((field) => {
      if (!field.k || (field.showIf && scope[field.showIf.k] !== field.showIf.eq)) return true;
      if (field.type === 'group') {
        const items = scope[field.k] || [];
        return items.length >= (field.min || 0) && items.every((item, i) => isComplete(field.fields.filter((f) => !(f.hideFirst && i === 0)), item || {}, locked));
      }
      const v = scope[field.k];
      if (field.deal && locked && locked[field.deal]) return true;
      if (field.req && blank(v)) return false;
      if (!blank(v) && field.type === 'ssn' && !ssnOk(v)) return false;
      return true;
    });
  }

  // Read-only summary of a list of fields as a <dl>.
  function summaryHtml(fields, scope, opts = {}) {
    let out = '';
    let rows = '';
    let pendingHeading = '';
    // Headings are written lazily so sections with nothing to show disappear when skipBlank is set.
    const flush = () => { if (rows) out += pendingHeading + '<dl class="kv">' + rows + '</dl>'; else if (!opts.skipBlank) out += pendingHeading; rows = ''; pendingHeading = ''; };
    fields.forEach((field) => {
      if (field.type === 'note') return;
      if (field.type === 'heading') { flush(); pendingHeading = '<h4 style="margin:14px 0 0;color:var(--navy)">' + esc(field.label) + '</h4>'; return; }
      if (field.showIf && scope[field.showIf.k] !== field.showIf.eq) return;
      if (field.type === 'group') {
        const items = scope[field.k] || [];
        if (items.length) { out += pendingHeading; pendingHeading = ''; }
        flush();
        if (!items.length) { rows += '<dt>' + esc(field.label) + '</dt><dd class="muted">None</dd>'; return; }
        items.forEach((item, i) => {
          out += '<h4 style="margin:14px 0 0">' + esc(field.itemLabel(i)) + '</h4>';
          out += summaryHtml(field.fields.filter((f) => !(f.hideFirst && i === 0)), item, opts);
        });
        return;
      }
      const v = display(field, scope[field.k], opts);
      if (!v && opts.skipBlank) return;
      rows += '<dt>' + esc(field.label) + '</dt><dd>' + (v ? esc(v) : '<span class="muted">—</span>') + '</dd>';
    });
    flush();
    return out;
  }

  root.DRUI = { esc, blank, money, date, maskSsn, display, renderFields, isComplete, summaryHtml, formatPhone };
})(this);
