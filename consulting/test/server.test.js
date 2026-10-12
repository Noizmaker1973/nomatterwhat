const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, rateLimiter } = require('../src/server');
const links = require('../src/links');
const { extract } = require('../src/fetch-site');
const { POOR_HTML } = require('./fixtures');

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

const env = { AUDIT_PRICE_ID: 'price_a', MONITOR_PRICE_ID: 'price_m', LINK_SECRET: 'secret', STRIPE_WEBHOOK_SECRET: 'w', RESEND_API_KEY: 'k' };

test('rateLimiter allows N per window', () => {
  const allow = rateLimiter(2, 1000);
  assert.ok(allow('a', 0)); assert.ok(allow('a', 1)); assert.ok(!allow('a', 2)); assert.ok(allow('b', 2)); assert.ok(allow('a', 1001));
});

test('/order creates the right Checkout Session for each plan', async () => {
  const created = [];
  const stripe = { checkout: { sessions: { create: async (p) => { created.push(p); return { url: 'https://checkout.stripe.test/x' }; } } } };
  await withServer(createApp({ stripe, env, deps: {} }), async (base) => {
    const a = await fetch(`${base}/order?plan=audit&website=acme.test&email=a@x.test`, { redirect: 'manual' });
    assert.equal(a.status, 303);
    assert.equal(a.headers.get('location'), 'https://checkout.stripe.test/x');
    assert.equal(created[0].mode, 'payment');
    assert.equal(created[0].line_items[0].price, 'price_a');
    assert.deepEqual(created[0].metadata, { product: 'site-audit', website: 'https://acme.test/' });
    assert.deepEqual(created[0].payment_intent_data.metadata, { website: 'https://acme.test/' });
    assert.equal(created[0].customer_email, 'a@x.test');

    const m = await fetch(`${base}/order`, { method: 'POST', body: new URLSearchParams({ plan: 'monitor', website: 'https://acme.test' }), redirect: 'manual' });
    assert.equal(m.status, 303);
    assert.equal(created[1].mode, 'subscription');
    assert.equal(created[1].line_items[0].price, 'price_m');
    assert.deepEqual(created[1].subscription_data.metadata, { website: 'https://acme.test/' });

    const bad = await fetch(`${base}/order?plan=audit&website=http://127.0.0.1`, { redirect: 'manual' });
    assert.equal(bad.status, 400);
    assert.equal(created.length, 2);
  });
});

test('/scan returns results, emails the lead, validates input and rate-limits', async () => {
  const mails = [];
  const crawlSite = async (url) => ({ home: extract({ url, html: POOR_HTML, bytes: 100, responseMs: 100 }), subpages: [] });
  const app = createApp({ stripe: {}, env, deps: {}, crawlSite, mailer: async (m) => { mails.push(m); } });
  await withServer(app, async (base) => {
    const scan = (body) => fetch(`${base}/scan`, { method: 'POST', body: new URLSearchParams(body) });
    const ok = await scan({ website: 'acme.test', email: 'lead@x.test' });
    assert.equal(ok.status, 200);
    const html = await ok.text();
    assert.match(html, /Free Website Scan/);
    assert.match(html, /order\?plan=audit&amp;website=https%3A%2F%2Facme\.test%2F&amp;email=lead%40x\.test/);
    await new Promise((r) => setImmediate(r));
    assert.equal(mails[0].to, 'lead@x.test');

    assert.equal((await scan({ website: 'acme.test', email: 'nope' })).status, 400);
    for (let i = 0; i < 4; i++) await scan({ website: 'acme.test', email: 'lead@x.test' });
    assert.equal((await scan({ website: 'acme.test', email: 'lead@x.test' })).status, 429);
  });
});

test('webhook verifies signatures and starts delivery for our sessions only', async () => {
  const retrievedPIs = [];
  const stripe = {
    webhooks: { constructEvent: (body, sig) => { if (sig !== 'good') throw new Error('bad'); return JSON.parse(body.toString()); } },
    paymentIntents: { retrieve: async (id) => { retrievedPIs.push(id); return { id, metadata: { fulfilled_at: '1' } }; } },
  };
  const app = createApp({ stripe, env, deps: {} });
  const event = (product) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', payment_intent: 'pi_1', metadata: { product } } } });
  await withServer(app, async (base) => {
    const post = (sig, body) => fetch(`${base}/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body });
    assert.equal((await post('bad', event('site-audit'))).status, 400);
    assert.equal((await post('good', event('other'))).status, 200);
    assert.equal((await post('good', event('site-audit'))).status, 200);
    await app.locals.lastDelivery;
    assert.deepEqual(retrievedPIs, ['pi_1']);
  });
});

test('/manage requires a valid signed link', async () => {
  const stripe = { billingPortal: { sessions: { create: async (p) => ({ url: `https://billing.stripe.test/${p.customer}` }) } } };
  await withServer(createApp({ stripe, env, deps: {} }), async (base) => {
    const good = new URL(links.manageUrl(base, 'cus_1', 'secret'));
    const ok = await fetch(good, { redirect: 'manual' });
    assert.equal(ok.headers.get('location'), 'https://billing.stripe.test/cus_1');
    assert.equal((await fetch(`${base}/manage?c=cus_2&s=${good.searchParams.get('s')}`, { redirect: 'manual' })).status, 403);
  });
});
