(function () {
  const { esc, summaryHtml, money } = DRUI;
  const { FORMS, DEAL_SHEET, num } = DR;
  const dealId = new URLSearchParams(location.search).get('deal');
  const out = document.getElementById('out');
  // Commission fields are internal; leave them off packages sent to landlords unless asked.
  const COMMISSION = ['commissionTotal', 'agentSplit', 'referral', 'commission', 'notes', 'coBroke'];
  let deal;

  function draw() {
    const form = FORMS[deal.formType];
    const reveal = document.getElementById('ssn').checked;
    const showSheet = document.getElementById('dealsheet').checked;
    const showCommission = document.getElementById('commission').checked;
    const sheetFields = DEAL_SHEET.concat(form.dealSheet || []).filter((f) => showCommission || !COMMISSION.includes(f.k));
    const where = [deal.sheet.address, deal.sheet.unit && 'Unit ' + deal.sheet.unit, deal.sheet.city].filter(Boolean).join(', ');
    const income = deal.applicants.reduce((n, a) => n + (a.monthlyIncome || 0), 0);
    const rent = num(deal.sheet.finalRent || deal.sheet.rent);

    out.innerHTML = `
      <div class="brand"><img src="/assets/logo.png" alt="Dibiasio Realty">
        <div class="right"><b style="color:var(--ink);font-size:1.1rem">${esc(form.title)}</b><br>${esc(where)}<br>Status: ${esc(deal.status)} · Agent: ${esc(deal.agentName)}<br>Printed ${new Date().toLocaleString()}</div></div>
      ${form.contact ? '<p class="small muted">' + esc(form.name) + ' · ' + esc(form.contact) + '</p>' : ''}
      <section class="block"><h2>Summary</h2><dl class="kv">
        <dt>Applicants</dt><dd>${deal.applicants.map((a) => esc(a.name)).join(', ') || '—'}</dd>
        <dt>Rent</dt><dd>${rent ? money(rent) : '—'}</dd>
        <dt>Stated household income</dt><dd>${income ? money(income) + '/mo' + (rent ? ' (' + (income / rent).toFixed(2) + '× rent)' : '') : '—'}</dd>
        <dt>Credit</dt><dd>${deal.applicants.map((a) => esc(a.name) + ': ' + esc(a.credit.status) + (a.credit.score ? ' (' + esc(a.credit.score) + ')' : '')).join('<br>') || '—'}</dd>
        <dt>Eviction check</dt><dd>${deal.applicants.map((a) => esc(a.name) + ': ' + esc(DREviction.summary(a.eviction))).join('<br>') || '—'}</dd>
      </dl></section>
      ${showSheet ? '<section class="block"><h2>Deal sheet</h2>' + summaryHtml(sheetFields, deal.sheet, { skipBlank: true }) + '</section>' : ''}
      ${deal.applicants.map((a) => {
        const app = a.application;
        const sig = app.signature || {};
        return `<div class="applicant">
          <section class="block"><h2>Applicant: ${esc(a.name)}</h2>
            ${form.steps.map((s) => '<h3 style="margin-top:12px">' + esc(s.title) + '</h3>' + summaryHtml(s.fields, app.answers, { revealSsn: reveal })).join('')}
          </section>
          <section class="block"><h2>Documents received</h2><dl class="kv">
            ${form.documents.map((d) => { const files = a.files.filter((f) => f.docType === d.id); return '<dt>' + esc(d.label) + '</dt><dd>' + (files.length ? files.map((f) => esc(f.name)).join(', ') : d.req ? '<b>Missing</b>' : '—') + '</dd>'; }).join('')}
          </dl></section>
          <section class="block"><h2>Certification & signature</h2>
            ${form.authorization ? '<div class="legal">' + esc(form.authorization) + '</div>' : ''}
            <div class="legal">${esc(form.certification)}</div>
            <p class="small">Consented electronically to: certification, credit/background check, and electronic signature.</p>
            ${sig.image ? '<img class="sig-img" src="' + esc(sig.image) + '" alt="Signature" style="max-width:300px;border:1px solid var(--line);border-radius:6px">' : ''}
            <dl class="kv"><dt>Signed by</dt><dd>${esc(sig.typedName)}</dd><dt>Date</dt><dd>${sig.signedAt ? new Date(sig.signedAt).toLocaleString() : ''}</dd>
            ${(app.otherSigners || []).map((o) => '<dt>Other adult</dt><dd>' + esc(o.member) + ' — signed “' + esc(o.name) + '”</dd>').join('')}</dl>
          </section></div>`;
      }).join('')}
      <p class="small muted" style="margin-top:24px">Prepared by Dibiasio Realty. Contains confidential personal information — handle and dispose of securely.</p>`;
  }

  fetch('/api/deals/' + encodeURIComponent(dealId)).then(async (r) => {
    if (!r.ok) { out.innerHTML = '<p>Please <a href="/agent">sign in</a> first.</p>'; return; }
    deal = await r.json();
    document.title = 'Application – ' + deal.applicants.map((a) => a.name).join(', ') + ' | Dibiasio Realty';
    draw();
  });
  ['ssn', 'dealsheet', 'commission'].forEach((id) => document.getElementById(id).onchange = draw);
  document.getElementById('print').onclick = () => window.print();
})();
