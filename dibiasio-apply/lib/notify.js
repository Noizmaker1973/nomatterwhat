// Optional email alerts to agents. Configure SMTP_URL (e.g.
// smtps://user:app-password@smtp.gmail.com) to enable; otherwise alerts are
// only logged. Emails never include applicant personal data — just a link to
// the dashboard.
const nodemailer = require('nodemailer');

const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const FROM = process.env.MAIL_FROM || 'Dibiasio Realty Applications <no-reply@dibiasiorealty.com>';
const FALLBACK = process.env.NOTIFY_EMAIL || '';

async function send(to, subject, text) {
  const recipients = [...new Set([to, FALLBACK].filter(Boolean))];
  if (!transport || !recipients.length) {
    console.log('[notify] %s → %s', subject, recipients.join(', ') || '(no recipient)');
    return;
  }
  await transport.sendMail({ from: FROM, to: recipients.join(', '), subject, text });
}

const where = (deal) => [deal.sheet.address, deal.sheet.unit && 'Unit ' + deal.sheet.unit].filter(Boolean).join(', ') || 'no property set yet';

module.exports = {
  newApplication: ({ deal, appRecord, agent, form, dashboardUrl }) => send(
    agent && agent.email,
    'New ' + form.short + ' application: ' + appRecord.summary.name,
    appRecord.summary.name + ' submitted a ' + form.title + ' (' + where(deal) + ') with ' + appRecord.files.length + ' document(s).\n\nOpen it in the dashboard:\n' + dashboardUrl,
  ),
  moreDocuments: ({ deal, appRecord, agent, count, dashboardUrl }) => send(
    agent && agent.email,
    appRecord.summary.name + ' uploaded ' + count + ' more document(s)',
    appRecord.summary.name + ' added documents to their application (' + where(deal) + ').\n\n' + dashboardUrl,
  ),
};
