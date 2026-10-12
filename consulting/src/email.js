// Sending through Resend, plus the HTML for the paid report and the free scan.

const RESEND_URL = 'https://api.resend.com/emails';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail(message, { apiKey, from, replyTo, idempotencyKey, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const body = { from, ...message, to: [message.to] };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetchImpl(RESEND_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Optional: add free-scan leads to a Resend audience for later broadcasts.
async function addContact(email, { apiKey, audienceId, fetchImpl = fetch }) {
  if (!audienceId) return;
  const res = await fetchImpl(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, unsubscribed: false }),
  });
  if (!res.ok) console.error(`Adding contact failed: ${res.status} ${await res.text()}`);
}

const FONT = 'font-family:Helvetica,Arial,sans-serif';
const PRIORITY_COLOR = { high: '#b42318', medium: '#b54708', low: '#475467' };

function scoreColor(score) {
  return score >= 80 ? '#067647' : score >= 60 ? '#b54708' : '#b42318';
}

function layout(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f2f4f7;${FONT};color:#101828">
<div style="max-width:680px;margin:0 auto;padding:28px 16px">${inner}</div></body></html>`;
}

function paragraphs(text) {
  return String(text).split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${escapeHtml(p.trim())}</p>`).join('');
}

function renderReport(report, { brandName, siteUrl, date, manageUrl, previousScore }) {
  const delta = previousScore == null ? '' : ` (${report.overallScore - previousScore >= 0 ? '+' : ''}${report.overallScore - previousScore} since last month)`;
  const sections = report.sections.map((s) => `
<div style="background:#fff;border-radius:8px;padding:20px;margin:16px 0">
  <h2 style="font-size:18px;margin:0 0 4px">${escapeHtml(s.area)} <span style="color:${scoreColor(s.score)}">${s.score}/100</span></h2>
  <p style="font-size:14px;color:#475467;margin:0 0 12px">${escapeHtml(s.summary)}</p>
  ${s.findings.map((f) => `
  <div style="border-top:1px solid #eaecf0;padding:12px 0">
    <p style="margin:0 0 6px;font-size:15px"><b>${escapeHtml(f.title)}</b>
      <span style="font-size:11px;text-transform:uppercase;color:${PRIORITY_COLOR[f.priority]};margin-left:6px">${escapeHtml(f.priority)} priority</span>
      <span style="font-size:11px;text-transform:uppercase;color:#475467;margin-left:6px">${escapeHtml(f.effort)}</span></p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.5"><b>What we saw:</b> ${escapeHtml(f.evidence)}</p>
    <p style="margin:0 0 6px;font-size:14px;line-height:1.5"><b>Why it matters:</b> ${escapeHtml(f.whyItMatters)}</p>
    <p style="margin:0;font-size:14px;line-height:1.5"><b>Do this:</b> ${escapeHtml(f.recommendation)}</p>
  </div>`).join('')}
</div>`).join('');

  const html = layout(`
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#475467;margin:0">${escapeHtml(brandName)} · Website Audit · ${escapeHtml(date)}</p>
<h1 style="font-size:26px;margin:6px 0 4px">${escapeHtml(siteUrl)}</h1>
<p style="font-size:40px;font-weight:700;margin:8px 0;color:${scoreColor(report.overallScore)}">${report.overallScore}/100<span style="font-size:15px;color:#475467;font-weight:400">${escapeHtml(delta)}</span></p>
<p style="font-size:17px;font-weight:600;margin:0 0 16px">${escapeHtml(report.headline)}</p>
${paragraphs(report.executiveSummary)}
<div style="background:#ecfdf3;border-radius:8px;padding:18px 20px;margin:16px 0">
  <h2 style="font-size:18px;margin:0 0 8px">Quick wins for this week</h2>
  <ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.6">${report.quickWins.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ol>
</div>
<div style="background:#fff;border-radius:8px;padding:18px 20px;margin:16px 0">
  <h2 style="font-size:18px;margin:0 0 8px">Suggested hero rewrite</h2>
  <p style="font-size:20px;font-weight:700;margin:0 0 4px">${escapeHtml(report.rewrite.headline)}</p>
  <p style="font-size:15px;margin:0 0 10px;color:#475467">${escapeHtml(report.rewrite.subheadline)}</p>
  <span style="display:inline-block;background:#1570ef;color:#fff;border-radius:6px;padding:8px 14px;font-size:14px">${escapeHtml(report.rewrite.primaryCta)}</span>
</div>
${sections}
<div style="background:#fff;border-radius:8px;padding:18px 20px;margin:16px 0">
  <h2 style="font-size:18px;margin:0 0 8px">90-day plan</h2>
  ${report.plan.map((p) => `<p style="margin:12px 0 4px;font-size:15px"><b>${escapeHtml(p.phase)}: ${escapeHtml(p.focus)}</b></p>
  <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6">${p.actions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`).join('')}
</div>
<p style="font-size:12px;color:#667085;line-height:1.5">This audit is based on an automated crawl of your public pages and expert analysis of their content. Reply to this email with any questions.${manageUrl ? ` <a href="${escapeHtml(manageUrl)}" style="color:#1570ef">Manage your subscription</a>.` : ''}</p>`);

  const text = [
    `${brandName} Website Audit: ${siteUrl} (${date})`,
    `Score: ${report.overallScore}/100${delta}`,
    report.headline,
    report.executiveSummary,
    `QUICK WINS\n${report.quickWins.map((w, i) => `${i + 1}. ${w}`).join('\n')}`,
    `SUGGESTED HERO\n${report.rewrite.headline}\n${report.rewrite.subheadline}\n[${report.rewrite.primaryCta}]`,
    ...report.sections.map((s) => `${s.area.toUpperCase()} (${s.score}/100)\n${s.summary}\n\n${s.findings.map((f) => `* ${f.title} [${f.priority}, ${f.effort}]\n  Seen: ${f.evidence}\n  Why: ${f.whyItMatters}\n  Do: ${f.recommendation}`).join('\n\n')}`),
    `90-DAY PLAN\n${report.plan.map((p) => `${p.phase}: ${p.focus}\n${p.actions.map((a) => `  - ${a}`).join('\n')}`).join('\n')}`,
    manageUrl ? `Manage your subscription: ${manageUrl}` : '',
  ].filter(Boolean).join('\n\n');

  return { subject: `Your website audit: ${siteUrl} scored ${report.overallScore}/100`, html, text };
}

function renderFreeScan(checks, { brandName, siteUrl, checkoutUrl }) {
  const top = checks.failing.slice(0, 3);
  const hidden = Math.max(checks.failing.length - top.length, 0);
  const html = layout(`
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#475467;margin:0">${escapeHtml(brandName)} · Free Website Scan</p>
<h1 style="font-size:24px;margin:6px 0">${escapeHtml(siteUrl)}</h1>
<p style="font-size:40px;font-weight:700;margin:8px 0;color:${scoreColor(checks.score)}">${checks.score}/100</p>
<div style="background:#fff;border-radius:8px;padding:18px 20px">
${top.length ? `<h2 style="font-size:18px;margin:0 0 8px">Your top ${top.length} issues</h2>
${top.map((c) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px"><b>${escapeHtml(c.label)}</b><br>${escapeHtml(c.fix)}</p>`).join('')}` : '<p style="font-size:15px">Your site passed every automated check. The full audit looks deeper at your messaging, offer and conversion path, which is where most of the remaining upside usually is.</p>'}
${hidden ? `<p style="font-size:14px;color:#475467">+ ${hidden} more automated issue${hidden === 1 ? '' : 's'} found.</p>` : ''}
</div>
<div style="background:#1570ef;color:#fff;border-radius:8px;padding:20px;margin:16px 0">
<p style="font-size:17px;font-weight:700;margin:0 0 6px">Want the full consultant-grade audit?</p>
<p style="font-size:14px;line-height:1.5;margin:0 0 12px">A detailed review of your messaging, calls to action, trust signals, SEO and mobile experience, with specific fixes, rewritten headline copy and a 90-day plan. Delivered to your inbox in about 15 minutes.</p>
<a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#fff;color:#1570ef;font-weight:700;border-radius:6px;padding:10px 16px;text-decoration:none">Get the full audit</a>
</div>`);
  const text = [
    `${brandName} free scan: ${siteUrl}`,
    `Score: ${checks.score}/100`,
    ...top.map((c) => `- ${c.label}: ${c.fix}`),
    hidden ? `+ ${hidden} more issues found.` : '',
    `Get the full audit: ${checkoutUrl}`,
  ].filter(Boolean).join('\n\n');
  return { subject: `Your website scored ${checks.score}/100`, html, text };
}

module.exports = { sendEmail, addContact, renderReport, renderFreeScan, escapeHtml };
