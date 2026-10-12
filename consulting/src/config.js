// All settings come from the environment so the same code runs locally, in
// tests, and on the host.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

module.exports = {
  required,
  brandName: process.env.BRAND_NAME || 'ClearPath Audits',
  baseUrl: (process.env.BASE_URL || 'http://localhost:4100').replace(/\/$/, ''),
  port: Number(process.env.PORT || 4100),
  fromEmail: process.env.FROM_EMAIL || 'ClearPath Audits <reports@example.com>',
  replyTo: process.env.REPLY_TO || undefined,
  model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
  // Days between reports for monthly "Growth Partner" subscribers.
  monitorIntervalDays: Number(process.env.MONITOR_INTERVAL_DAYS || 30),
  // Free scans per IP per hour; the free scan fetches arbitrary sites, so cap it.
  freeScansPerHour: Number(process.env.FREE_SCANS_PER_HOUR || 5),
};
