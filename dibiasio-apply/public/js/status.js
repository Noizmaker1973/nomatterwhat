(function () {
  const { esc } = DRUI;
  const { t } = DRI18N;
  const $app = document.getElementById('app');
  const token = new URLSearchParams(location.search).get('t') || '';

  async function load() {
    const res = await fetch('/api/public/status/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) {
      $app.innerHTML = '<div class="card"><h1>' + esc(t('Link not found')) + '</h1><p>' + esc(t(data.error)) + ' ' + esc(t('Please contact your agent.')) + '</p></div>';
      return;
    }
    const form = DR.FORMS[data.formType];
    const lang = DRI18N.setLang((form.languages || []).includes(data.lang) ? data.lang : 'en');
    const submitted = new Date(data.submittedAt).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US');
    const have = (id) => data.files.filter((f) => f.docType === id);
    $app.innerHTML = `
      <div class="card">
        <span class="step-label">${esc(t(form.title))}</span>
        <h1>${esc(t('Hi {name}', { name: (data.name || '').split(' ')[0] }))}</h1>
        <p class="muted">${esc(data.property ? t('Submitted {date} for {property}.', { date: submitted, property: data.property }) : t('Submitted {date}.', { date: submitted }))}</p>
        <p>${esc(t('Status:'))} <span class="pill">${esc(t(data.status))}</span></p>
      </div>
      ${data.creditScreeningUrl ? `<div class="card"><h2>${esc(t('Credit check'))}</h2><p class="muted">${esc(t('If you haven\'t yet, complete your credit check so the landlord can review your application.'))}</p><a class="btn" href="${esc(data.creditScreeningUrl)}" target="_blank" rel="noopener">${esc(t('Start credit check'))}</a></div>` : ''}
      <div class="card">
        <h2>${esc(t('Your documents'))}</h2>
        <p class="muted">${esc(t('Add anything that\'s missing or that your agent asked for. Files up to 20 MB each.'))}</p>
        <div id="ok" class="notice ok hidden"></div>
        ${form.documents.map((d) => `
          <div class="doc ${have(d.id).length ? 'done' : ''}">
            <div class="doc-head">
              <div><b>${esc(t(d.label))} ${have(d.id).length ? '<span class="pill ok">' + esc(t('Received')) + '</span>' : d.req ? '<span class="pill warn">' + esc(t('Needed')) + '</span>' : ''}</b>
              ${d.help ? '<span class="small muted">' + esc(t(d.help)) + '</span>' : ''}${d.download ? '<br><a class="small" href="' + esc(d.download) + '" target="_blank" download>' + esc(t('⬇ Download the blank guarantor form (PDF)')) + '</a>' : ''}</div>
              <label class="btn secondary small">${esc(t('Upload'))}<input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.heic" class="hidden" data-doc="${d.id}"></label>
            </div>
            ${have(d.id).length ? '<ul>' + have(d.id).map((f) => '<li><span>📄</span><span class="name">' + esc(f.name) + '</span><span class="muted small">' + new Date(f.uploadedAt).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en-US') + '</span></li>').join('') + '</ul>' : ''}
          </div>`).join('')}
        <div class="doc"><div class="doc-head"><div><b>${esc(t('Something else'))}</b><span class="small muted">${esc(t('Any other document your agent requested.'))}</span></div>
          <label class="btn secondary small">${esc(t('Upload'))}<input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.heic" class="hidden" data-doc="other"></label></div></div>
      </div>`;
    $app.insertAdjacentHTML('beforeend', DRGuarantor.html());
    DRGuarantor.bind($app, { applicantName: data.name, property: data.property, agent: data.agent });
    $app.querySelectorAll('input[type=file]').forEach((input) => input.onchange = () => upload(input));
  }

  async function upload(input) {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach((f) => fd.append('doc_' + input.dataset.doc, f, f.name));
    input.closest('label').textContent = t('Uploading…');
    const res = await fetch('/api/public/status/' + encodeURIComponent(token) + '/files', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    await load();
    const ok = document.getElementById('ok');
    ok.textContent = res.ok ? t('Thanks! Your agent has been notified.') : t(data.error || 'Upload failed. Please try again.');
    ok.className = 'notice ' + (res.ok ? 'ok' : 'bad');
  }

  load();
})();
