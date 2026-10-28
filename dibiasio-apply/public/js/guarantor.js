// "Need a guarantor or cosigner?" box for applicants: download the blank form,
// or send it on. On phones the share sheet sends the PDF itself (email, text,
// etc.); elsewhere an email opens with a download link, since mailto links
// can't carry attachments.
(function (root) {
  const { esc } = DRUI;
  const { t } = DRI18N;
  const url = () => location.origin + DR.GUARANTOR_URL;

  function message({ applicantName, property, agent }) {
    const lines = [
      t('Hi,'),
      '',
      property ? t('I\'m applying for an apartment at {property} and need a guarantor (cosigner). Would you be willing to help?', { property })
        : t('I\'m applying for an apartment and need a guarantor (cosigner). Would you be willing to help?'),
      '',
      t('Here is the Guarantor Form: {url}', { url: url() }),
      '',
      agent && agent.email ? t('Please fill it out, sign it, and send it back to me, or straight to my agent, {name}, at {email}.', { name: agent.name, email: agent.email })
        : t('Please fill it out, sign it, and send it back to me.'),
      '',
      t('Thank you!'),
    ];
    if (applicantName) lines.push(applicantName);
    return lines.join('\n');
  }

  function html() {
    return '<div class="card" data-guarantor><h2>' + esc(t('Need a guarantor or cosigner?')) + '</h2>' +
      '<p class="muted">' + esc(t('If someone is guaranteeing your lease, they need to fill out and sign this form. Download it, or send it straight to them.')) + '</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<a class="btn secondary" href="' + esc(DR.GUARANTOR_URL) + '" target="_blank" download="Guarantor Form.pdf">' + esc(t('⬇ Download form (PDF)')) + '</a>' +
      '<button type="button" class="btn secondary" data-guarantor-send>' + esc(t('✉ Email / share with my guarantor')) + '</button></div>' +
      '<p class="small muted" style="margin:10px 0 0">' + t('When it comes back signed, upload it under <b>Guarantor form</b>.') + '</p></div>';
  }

  // opts: { applicantName, property, agent: { name, email } } — read when clicked, so they can change.
  function bind(container, opts) {
    const btn = container.querySelector('[data-guarantor-send]');
    if (!btn) return;
    btn.onclick = async () => {
      const o = typeof opts === 'function' ? opts() : opts || {};
      const subject = t('Guarantor form for my apartment application');
      const text = message(o);
      if (navigator.canShare) {
        try {
          const blob = await fetch(DR.GUARANTOR_URL).then((r) => r.blob());
          const file = new File([blob], 'Guarantor Form.pdf', { type: 'application/pdf' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: subject, text });
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return; // they closed the share sheet
        }
      }
      location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
    };
  }

  root.DRGuarantor = { html, bind, message };
})(this);
