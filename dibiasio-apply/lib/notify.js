// Email from the company mailbox (e.g. james@dibiasiorealty.com): alerts to
// agents when applications / documents arrive, and messages agents send to
// applicants from the dashboard.
//
// Configure either SMTP_URL, or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
// (keeping the password in its own variable). Without them, alerts are only
// logged (unless NTFY_TOPIC is set, below) and the dashboard falls back to
// opening the agent's own mail app.
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

// Alerts go out by SMTP when it's configured. With NTFY_TOPIC set they also go
// to the ntfy app as a phone notification, and — when there's no SMTP — ntfy
// forwards them as an email. ntfy is a third-party service, so its messages
// carry only the application type, property and a dashboard link, never the
// applicant's name or details.
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';

async function push({ title, message, url, email }) {
  const headers = { Title: title, Click: url, Tags: 'house', Priority: 'high' };
  if (email) headers.Email = email;
  const res = await fetch(NTFY_SERVER + '/' + encodeURIComponent(NTFY_TOPIC), { method: 'POST', headers, body: message });
  if (!res.ok) throw new Error('ntfy responded ' + res.status + ' ' + (await res.text()).slice(0, 200));
}

async function alert(to, { subject, text, title, message, url }) {
  const recipients = [...new Set([to, FALLBACK].filter(Boolean))];
  const jobs = [];
  if (transport && recipients.length) {
    jobs.push(transport.sendMail({ from: { name: FROM_NAME + ' Applications', address: FROM_ADDRESS }, to: recipients.join(', '), subject, text }));
  }
  if (NTFY_TOPIC) {
    // ntfy forwards to one address per message, so send the email copies separately.
    const emails = transport ? [] : recipients;
    jobs.push(push({ title, message, url, email: emails[0] }));
    emails.slice(1).forEach((email) => jobs.push(push({ title, message, url, email })));
  }
  if (!jobs.length) console.log('[notify] %s (no alert channel configured)', subject);
  const failed = (await Promise.allSettled(jobs)).filter((r) => r.status === 'rejected');
  if (failed.length) throw new Error(failed.map((r) => r.reason.message).join('; '));
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
  newApplication: ({ deal, appRecord, agent, form, dashboardUrl }) => alert(agent && agent.email, {
    subject: 'New ' + form.short + ' application: ' + appRecord.summary.name,
    text: appRecord.summary.name + ' submitted a ' + form.title + ' (' + where(deal) + ') with ' + appRecord.files.length + ' document(s).\n\nOpen it in the dashboard:\n' + dashboardUrl,
    title: 'New ' + form.short + ' application',
    message: where(deal) + ' - ' + appRecord.files.length + ' document(s). Tap to open the dashboard: ' + dashboardUrl,
    url: dashboardUrl,
  }),
  moreDocuments: ({ deal, appRecord, agent, count, dashboardUrl }) => alert(agent && agent.email, {
    subject: appRecord.summary.name + ' uploaded ' + count + ' more document(s)',
    text: appRecord.summary.name + ' added documents to their application (' + where(deal) + ').\n\n' + dashboardUrl,
    title: 'New documents uploaded',
    message: count + ' document(s) added for ' + where(deal) + '. Tap to open the dashboard: ' + dashboardUrl,
    url: dashboardUrl,
  }),
};
