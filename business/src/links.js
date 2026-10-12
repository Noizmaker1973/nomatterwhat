// Signed "manage subscription" links. Each email carries a link bound to the
// recipient's Stripe customer id, so a subscriber can cancel or update billing
// in one click without a password, and nobody can forge a link for someone else.

const crypto = require('crypto');

function sign(customerId, secret) {
  return crypto.createHmac('sha256', secret).update(customerId).digest('base64url');
}

function manageUrl(baseUrl, customerId, secret) {
  const params = new URLSearchParams({ c: customerId, s: sign(customerId, secret) });
  return `${baseUrl}/manage?${params}`;
}

function verify(customerId, signature, secret) {
  if (typeof customerId !== 'string' || typeof signature !== 'string') return false;
  const expected = Buffer.from(sign(customerId, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { sign, manageUrl, verify };
