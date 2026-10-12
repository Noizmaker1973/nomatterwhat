const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../src/links');
const { renderEmail, sendBatch } = require('../src/email');
const { listSubscribers } = require('../src/subscribers');
const { generateReflection } = require('../src/content');
const { createApp } = require('../src/server');

const reflection = {
  date: 'Monday, October 12, 2026',
  title: 'Just <for> Today',
  theme: 'One day at a time',
  reading: 'First paragraph.\n\nSecond & last paragraph.',
  action: 'Call your sponsor.',
  affirmation: 'I can do this today.',
};

test('manage links verify only with the right customer and secret', () => {
  const url = new URL(links.manageUrl('https://x.test', 'cus_123', 'secret'));
  const c = url.searchParams.get('c');
  const s = url.searchParams.get('s');
  assert.equal(c, 'cus_123');
  assert.ok(links.verify(c, s, 'secret'));
  assert.ok(!links.verify('cus_999', s, 'secret'));
  assert.ok(!links.verify(c, s, 'other'));
  assert.ok(!links.verify(c, undefined, 'secret'));
});

test('renderEmail escapes HTML and includes crisis resources and manage link', () => {
  const email = renderEmail(reflection, { brandName: 'ODD', manageUrl: 'https://x.test/manage?c=1&s=2' });
  assert.equal(email.subject, 'Just <for> Today · ODD');
  assert.match(email.html, /Just &lt;for&gt; Today/);
  assert.match(email.html, /Second &amp; last paragraph\./);
  assert.match(email.html, /988/);
  assert.match(email.html, /manage\?c=1&amp;s=2/);
  assert.match(email.text, /manage\?c=1&s=2/);
  assert.match(email.text, /1-800-662-4357/);
});

test('sendBatch splits into batches of 100 with per-batch idempotency keys', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ key: opts.headers['Idempotency-Key'], body: JSON.parse(opts.body) });
    return { ok: true };
  };
  const msgs = Array.from({ length: 250 }, (_, i) => ({ to: `u${i}@x.test`, subject: 's', text: 't', html: 'h' }));
  const sent = await sendBatch(msgs, { apiKey: 'k', from: 'f@x.test', idempotencyPrefix: 'daily-2026-10-12', fetchImpl });
  assert.equal(sent, 250);
  assert.deepEqual(calls.map((c) => c.body.length), [100, 100, 50]);
  assert.deepEqual(calls.map((c) => c.key), ['daily-2026-10-12-0', 'daily-2026-10-12-1', 'daily-2026-10-12-2']);
  assert.deepEqual(calls[0].body[0], { from: 'f@x.test', to: ['u0@x.test'], subject: 's', text: 't', html: 'h' });
});

test('sendBatch throws on a failed request', async () => {
  const fetchImpl = async () => ({ ok: false, status: 422, text: async () => 'bad' });
  await assert.rejects(sendBatch([{ to: 'a@x.test' }], { apiKey: 'k', from: 'f', fetchImpl }), /422 bad/);
});

test('listSubscribers keeps active/trialing subs on our price, deduped by customer', async () => {
  const sub = (status, customer, price = 'price_ours') => ({ status, customer, items: { data: [{ price: { id: price } }] } });
  const subs = [
    sub('active', { id: 'cus_1', email: 'a@x.test' }),
    sub('trialing', { id: 'cus_2', email: 'b@x.test' }),
    sub('canceled', { id: 'cus_3', email: 'c@x.test' }),
    sub('past_due', { id: 'cus_4', email: 'd@x.test' }),
    sub('active', { id: 'cus_5', email: 'e@x.test' }, 'price_other'),
    sub('active', { id: 'cus_6', deleted: true }),
    sub('active', { id: 'cus_1', email: 'a@x.test' }),
  ];
  const stripe = { subscriptions: { list: async function* () { yield* subs; } } };
  const result = await listSubscribers(stripe, 'price_ours');
  assert.deepEqual(result, [
    { customerId: 'cus_1', email: 'a@x.test' },
    { customerId: 'cus_2', email: 'b@x.test' },
  ]);
});

test('generateReflection returns parsed output and throws on refusal', async () => {
  const parsed = { title: 't', theme: 'th', reading: 'r', action: 'a', affirmation: 'af' };
  let request;
  const client = (resp) => ({ beta: { messages: { parse: async (req) => { request = req; return resp; } } } });

  const out = await generateReflection(new Date('2026-10-12T00:00:00Z'), client({ stop_reason: 'end_turn', parsed_output: parsed }));
  assert.equal(out.title, 't');
  assert.equal(out.date, 'Monday, October 12, 2026');
  assert.equal(request.fallbacks, 'default');
  assert.match(request.messages[0].content, /October 12, 2026/);

  await assert.rejects(
    generateReflection(new Date(), client({ stop_reason: 'refusal', stop_details: { category: 'x' } })),
    /declined/,
  );
});

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('server: checkout redirects to Stripe, manage requires a valid signature', async () => {
  const created = [];
  const stripe = {
    checkout: { sessions: { create: async (p) => { created.push(p); return { url: 'https://checkout.stripe.test/s' }; } } },
    billingPortal: { sessions: { create: async (p) => ({ url: `https://billing.stripe.test/${p.customer}` }) } },
  };
  const app = createApp({ stripe, env: { STRIPE_PRICE_ID: 'price_ours', LINK_SECRET: 'secret' } });
  await withServer(app, async (base) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /One Day Daily/);

    const co = await fetch(`${base}/checkout`, { method: 'POST', redirect: 'manual' });
    assert.equal(co.status, 303);
    assert.equal(co.headers.get('location'), 'https://checkout.stripe.test/s');
    assert.equal(created[0].mode, 'subscription');
    assert.equal(created[0].line_items[0].price, 'price_ours');

    const good = new URL(links.manageUrl(base, 'cus_1', 'secret'));
    const ok = await fetch(good, { redirect: 'manual' });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), 'https://billing.stripe.test/cus_1');

    const bad = await fetch(`${base}/manage?c=cus_2&s=${good.searchParams.get('s')}`, { redirect: 'manual' });
    assert.equal(bad.status, 403);
  });
});

test('server: webhook rejects bad signatures and sends welcome email on checkout', async () => {
  const sent = [];
  const stripe = {
    webhooks: {
      constructEvent: (body, sig) => {
        if (sig !== 'good') throw new Error('bad sig');
        return JSON.parse(body.toString());
      },
    },
  };
  const app = createApp({
    stripe,
    env: { LINK_SECRET: 'secret', RESEND_API_KEY: 'k', STRIPE_WEBHOOK_SECRET: 'w' },
    send: async (msgs, opts) => { sent.push({ msgs, opts }); return msgs.length; },
  });
  const event = {
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', customer: 'cus_1', customer_details: { email: 'new@x.test' } } },
  };
  await withServer(app, async (base) => {
    const post = (sig) => fetch(`${base}/webhooks/stripe`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, body: JSON.stringify(event),
    });
    assert.equal((await post('bad')).status, 400);
    assert.equal(sent.length, 0);
    assert.equal((await post('good')).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].msgs[0].to, 'new@x.test');
    assert.equal(sent[0].opts.idempotencyPrefix, 'welcome-cs_1');
    assert.match(sent[0].msgs[0].html, /manage\?c=cus_1/);
  });
});
