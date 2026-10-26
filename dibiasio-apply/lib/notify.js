// Email from the company mailbox (e.g. james@dibiasiorealty.com): alerts to
// agents when applications / documents arrive, and messages agents send to
// applicants from the dashboard.
//
// Configure either SMTP_URL, or SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS
// (keeping the password in its own variable). Without them, alerts are only
// logged (unless NTFY_TOPIC is set, below) and the dashboard falls back to
// opening the agent's own mail app.
// Alerts never include applicant personal data — just a link to the dashboard.
const https = require('https');
const http = require('http');
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

// Plain https request forced to IPv4 with a timeout: some hosts can't reach
// ntfy.sh over IPv6, which made fetch() fail with an unhelpful "fetch failed".
function post(target, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = (u.protocol === 'http:' ? http : https).request(u, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, family: 4, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => (res.statusCode < 300 ? resolve(data) : reject(new Error(u.host + ' responded ' + res.statusCode + ' ' + data.slice(0, 200)))));
    });
    req.on('timeout', () => req.destroy(new Error('timed out connecting to ' + u.host)));
    req.on('error', (e) => reject(new Error('could not reach ' + u.host + ': ' + (e.code || e.message))));
    req.end(body);
  });
}

async function push({ title, message, url, email }) {
  const headers = { Title: title, Click: url, Tags: 'house', Priority: 'high', 'Content-Type': 'text/plain; charset=utf-8' };
  if (email) headers.Email = email;
  const target = NTFY_SERVER + '/' + encodeURIComponent(NTFY_TOPIC);
  try {
    await post(target, headers, message);
  } catch (e) {
    if (/ responded 4/.test(e.message)) throw e; // a rejected request won't succeed on retry
    await new Promise((r) => setTimeout(r, 2000));
    await post(target, headers, message);
  }
}

// Resend (resend.com) emails alerts over HTTPS when SMTP isn't available. Without
// a verified domain, Resend only delivers to the account owner's own address, so
// these alerts go to RESEND_TO (default NOTIFY_EMAIL).
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_API_URL = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const RESEND_FROM = process.env.RESEND_FROM || 'Dibiasio Applications <onboarding@resend.dev>';
const RESEND_TO = process.env.RESEND_TO || FALLBACK;

async function resend({ subject, text }) {
  const body = JSON.stringify({ from: RESEND_FROM, to: [RESEND_TO], subject, text });
  const headers = { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' };
  try {
    await post(RESEND_API_URL, headers, body);
  } catch (e) {
    if (/ responded 4/.test(e.message)) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    await post(RESEND_API_URL, headers, body);
  }
}

async function alert(to, { subject, text, title, message, url }) {
  const recipients = [...new Set([to, FALLBACK].filter(Boolean))];
  const jobs = [];
  if (transport && recipients.length) {
    jobs.push(transport.sendMail({ from: { name: FROM_NAME + ' Applications', address: FROM_ADDRESS }, to: recipients.join(', '), subject, text }));
  }
  if (!transport && RESEND_API_KEY && RESEND_TO) jobs.push(resend({ subject, text }));
  if (NTFY_TOPIC) {
    // ntfy forwards to one address per message, so send the email copies separately.
    const emails = transport || RESEND_API_KEY ? [] : recipients;
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
  alertsConfigured: Boolean(transport || (RESEND_API_KEY && RESEND_TO) || NTFY_TOPIC),
  testAlert: (agent, dashboardUrl) => alert(agent.email, {
    subject: 'Test alert from your application portal',
    text: 'Alerts are working. New applications will show up like this.\n\n' + dashboardUrl,
    title: 'Test alert',
    message: 'Alerts are working. New applications will show up like this.',
    url: dashboardUrl,
  }),
  storageWarning: (st, dashboardUrl) => alert(null, {
    subject: (st.level === 2 ? 'URGENT: ' : '') + 'Application portal storage is ' + st.pct + '% full',
    text: 'The application portal has used ' + st.usedMB + ' MB of its ' + st.totalMB + ' MB storage disk (' + st.freeMB + ' MB left).\n\n' +
      (st.level === 2 ? 'New applications may start failing to save. ' : '') +
      'Increase the disk size in Render: open the dibiasio-apply service, go to Disks, and raise the size.\n\n' + dashboardUrl,
    title: 'Storage ' + st.pct + '% full',
    message: 'Application portal storage is ' + st.pct + '% full. Increase the disk size in Render.',
    url: dashboardUrl,
  }),
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
