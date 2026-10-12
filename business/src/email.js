// Renders the daily email and sends it through Resend's batch API.

const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const BATCH_SIZE = 100; // Resend's per-request batch limit

const CRISIS_FOOTER = {
  text: 'If you are in crisis: call or text 988 (Suicide & Crisis Lifeline), call SAMHSA at 1-800-662-4357, or text HOME to 741741. In an emergency, call 911.',
  html: 'If you are in crisis: call or text <b>988</b> (Suicide &amp; Crisis Lifeline), call SAMHSA at <b>1-800-662-4357</b>, or text <b>HOME</b> to <b>741741</b>. In an emergency, call 911.',
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderEmail(reflection, { brandName, manageUrl, intro }) {
  const paragraphs = reflection.reading.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const subject = `${reflection.title} · ${brandName}`;

  const text = [
    intro,
    `${reflection.date}`,
    `${reflection.title.toUpperCase()}`,
    `Theme: ${reflection.theme}`,
    ...paragraphs,
    `Today's action: ${reflection.action}`,
    `Affirmation: ${reflection.affirmation}`,
    '—',
    CRISIS_FOOTER.text,
    `${brandName} is a daily encouragement, not a substitute for meetings, a sponsor, or professional care.`,
    `Manage or cancel your subscription: ${manageUrl}`,
  ].filter(Boolean).join('\n\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Georgia,'Times New Roman',serif;color:#2b2b2b">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
${intro ? `<p style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#555">${escapeHtml(intro)}</p>` : ''}
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a7368;margin:0">${escapeHtml(reflection.date)} · ${escapeHtml(reflection.theme)}</p>
<h1 style="font-size:28px;line-height:1.2;margin:8px 0 20px">${escapeHtml(reflection.title)}</h1>
${paragraphs.map((p) => `<p style="font-size:17px;line-height:1.6">${escapeHtml(p)}</p>`).join('\n')}
<div style="background:#fff;border-left:4px solid #3f7d6e;padding:14px 18px;margin:24px 0">
<p style="margin:0 0 8px;font-size:16px"><b>Today's action:</b> ${escapeHtml(reflection.action)}</p>
<p style="margin:0;font-size:16px;font-style:italic">${escapeHtml(reflection.affirmation)}</p>
</div>
<hr style="border:none;border-top:1px solid #ddd6ca;margin:28px 0">
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#666">${CRISIS_FOOTER.html}</p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#666">${escapeHtml(brandName)} is a daily encouragement, not a substitute for meetings, a sponsor, or professional care. <a href="${escapeHtml(manageUrl)}" style="color:#3f7d6e">Manage or cancel your subscription</a>.</p>
</div></body></html>`;

  return { subject, text, html };
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// messages: [{ to, subject, html, text }]. idempotencyPrefix makes re-runs of
// the same day's job safe: Resend drops a batch whose key it has already seen.
async function sendBatch(messages, { apiKey, from, idempotencyPrefix, fetchImpl = fetch }) {
  let sent = 0;
  const batches = chunk(messages, BATCH_SIZE);
  for (const [i, batch] of batches.entries()) {
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    if (idempotencyPrefix) headers['Idempotency-Key'] = `${idempotencyPrefix}-${i}`;
    const res = await fetchImpl(RESEND_BATCH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(batch.map((m) => ({ from, ...m, to: [m.to] }))),
    });
    if (!res.ok) {
      throw new Error(`Resend batch ${i + 1}/${batches.length} failed: ${res.status} ${await res.text()}`);
    }
    sent += batch.length;
  }
  return sent;
}

module.exports = { renderEmail, sendBatch, escapeHtml, chunk, BATCH_SIZE };
