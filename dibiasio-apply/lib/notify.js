// Email from the company mailbox (e.g. james@dibiasiorealty.com): alerts to
// agents when applications / documents arrive, and messages agents send to
// applicants from the dashboard.
//
// Configure either SMTP_URL, or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
// (keeping the password in its own variable). Without them, alerts are only
// logged and the dashboard falls back to opening the agent's own mail app.
// Alerts never include applicant personal data — just a link to the dashboard.
const nodemailer = require('nodemailer');

function createTransport() {
  if (process.env.SMTP_URL) return nodemailer.createTransport(process.env.SMTP_URL);
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const transport = createTransport();
const FROM_ADDRESS = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || 'no-reply@dibiasiorealty.com';
const FROM_NAME = process.env.MAIL_FROM_NAME || 'Dibiasio Realty';
const FALLBACK = process.env.NOTIFY_EMAIL || '';

async function send(to, subject, text) {
  const recipients = [...new Set([to, FALLBACK].filter(Boolean))];
  if (!transport || !recipients.length) {
    console.log('[notify] %s → %s', subject, recipients.join(', ') || '(no recipient)');
    return;
  }
  await transport.sendMail({ from: { name: FROM_NAME + ' Applications', address: FROM_ADDRESS }, to: recipients.join(', '), subject, text });
}

const where = (deal) => [deal.sheet.address, deal.sheet.unit && 'Unit ' + deal.sheet.unit].filter(Boolean).join(', ') || 'no property set yet';

module.exports = {
  enabled: Boolean(transport),
  // Sent from the company address, shown as "Agent Name | Dibiasio Realty", replies to the agent.
  sendAs: (agent, { to, subject, text }) => transport.sendMail({
    from: { name: agent.name + ' | ' + FROM_NAME, address: FROM_ADDRESS },
    replyTo: agent.email,
    to,
    subject,
    text,
  }),
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
