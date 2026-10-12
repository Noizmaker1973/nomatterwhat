// Stripe is the subscriber database: anyone with an active or trialing
// subscription to our price gets the email. Cancel in Stripe and they stop
// receiving it on the next run, with no separate list to keep in sync.

const SENDABLE_STATUSES = new Set(['active', 'trialing']);

async function listSubscribers(stripe, priceId) {
  const byCustomer = new Map();
  const list = stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.customer'] });
  for await (const sub of list) {
    if (!SENDABLE_STATUSES.has(sub.status)) continue;
    if (priceId && !sub.items.data.some((item) => item.price.id === priceId)) continue;
    const customer = sub.customer;
    if (!customer || customer.deleted || !customer.email) continue;
    byCustomer.set(customer.id, { customerId: customer.id, email: customer.email });
  }
  return [...byCustomer.values()];
}

module.exports = { listSubscribers, SENDABLE_STATUSES };
