// Central configuration. Every value comes from the environment so the same
// code runs locally, in tests, and on the host without edits.

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

module.exports = {
  required,
  brandName: process.env.BRAND_NAME || 'One Day Daily',
  baseUrl: (process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, ''),
  port: Number(process.env.PORT || 4000),
  fromEmail: process.env.FROM_EMAIL || 'One Day Daily <daily@example.com>',
  trialDays: Number(process.env.TRIAL_DAYS || 7),
  model: process.env.CLAUDE_MODEL || 'claude-opus-5-5',
};
