(function () {
  const { esc } = DRUI;
  const $app = document.getElementById('app');
  const token = new URLSearchParams(location.search).get('t') || '';

  async function load() {
    const res = await fetch('/api/public/status/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) {
      $app.innerHTML = '<div class="card"><h1>Link not found</h1><p>' + esc(data.error) + ' Please contact your agent.</p></div>';
      return;
    }
    const form = DR.FORMS[data.formType];
    const have = (id) => data.files.filter((f) => f.docType === id);
    $app.innerHTML = `
      <div class="card">
        <span class="step-label">${esc(form.title)}</span>
        <h1>Hi ${esc((data.name || '').split(' ')[0])}</h1>
        <p class="muted">Submitted ${new Date(data.submittedAt).toLocaleDateString()}${data.property ? ' for ' + esc(data.property) : ''}.</p>
        <p>Status: <span class="pill">${esc(data.status)}</span></p>
      </div>
      ${data.reopened ? `<div class="card" style="border:2px solid var(--gold)"><h2>Your agent asked you to update your application</h2>
        ${data.reopened.note ? '<div class="notice warn">' + esc(data.reopened.note).replace(/\n/g, '<br>') + '</div>' : ''}
        <p class="muted">Your answers are saved. Open your application, make the changes, then sign again and submit.</p>
        <a class="btn" href="${esc(data.editUrl)}">Update my application</a></div>` : ''}
      ${data.creditScreeningUrl ? `<div class="card"><h2>Credit check</h2><p class="muted">If you haven't yet, complete your credit check so the landlord can review your application.</p><a class="btn" href="${esc(data.creditScreeningUrl)}" target="_blank" rel="noopener">Start credit check</a></div>` : ''}
      <div class="card">
        <h2>Your documents</h2>
        <p class="muted">Add anything that's missing or that your agent asked for. Files up to 20 MB each.</p>
        <div id="ok" class="notice ok hidden"></div>
        ${form.documents.map((d) => `
          <div class="doc ${have(d.id).length ? 'done' : ''}">
            <div class="doc-head">
              <div><b class="doc-title"><i class="dot${have(d.id).length ? ' ok' : d.req ? ' warn' : ''}" aria-hidden="true">${have(d.id).length ? '✓' : d.req ? '!' : ''}</i>${esc(d.label)} ${have(d.id).length ? '<span class="pill ok">Received</span>' : d.req ? '<span class="pill warn">Needed</span>' : ''}</b>
              ${d.help ? '<span class="small muted">' + esc(d.help) + '</span>' : ''}${d.download ? '<br><a class="small" href="' + esc(d.download) + '" target="_blank" download>⬇ Download the blank guarantor form (PDF)</a>' : ''}</div>
              <label class="btn secondary small">Upload<input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.heic" class="hidden" data-doc="${d.id}"></label>
            </div>
            ${have(d.id).length ? '<ul>' + have(d.id).map((f) => '<li><span class="file-badge" aria-hidden="true">' + esc((f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase()) + '</span><span class="name">' + esc(f.name) + '</span><span class="muted small">' + new Date(f.uploadedAt).toLocaleDateString() + '</span></li>').join('') + '</ul>' : ''}
          </div>`).join('')}
        ${form.documents.some((d) => d.id === 'other') ? '' : `<div class="doc"><div class="doc-head"><div><b>Something else</b><span class="small muted">Any other document your agent requested.</span></div>
          <label class="btn secondary small">Upload<input type="file" multiple accept="image/*,application/pdf,.doc,.docx,.heic" class="hidden" data-doc="other"></label></div></div>`}
      </div>`;
    if (!form.isGuarantor) $app.insertAdjacentHTML('beforeend', DRGuarantor.html());
    DRGuarantor.bind($app, { applicantName: data.name, property: data.property, agent: data.agent });
    $app.querySelectorAll('input[type=file]').forEach((input) => input.onchange = () => upload(input));
  }

  async function upload(input) {
    if (!input.files.length) return;
    const fd = new FormData();
    [...input.files].forEach((f) => fd.append('doc_' + input.dataset.doc, f, f.name));
    input.closest('label').textContent = 'Uploading…';
    const res = await fetch('/api/public/status/' + encodeURIComponent(token) + '/files', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    await load();
    const ok = document.getElementById('ok');
    ok.textContent = res.ok ? 'Thanks! Your agent has been notified.' : (data.error || 'Upload failed. Please try again.');
    ok.className = 'notice ' + (res.ok ? 'ok' : 'bad');
  }

  load();
})();
