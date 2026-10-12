const test = require('node:test');
const assert = require('node:assert/strict');
const fulfill = require('../src/fulfill');
const { generateReport, buildPrompt } = require('../src/report');
const { renderReport, renderFreeScan } = require('../src/email');
const { extract } = require('../src/fetch-site');
const { runChecks } = require('../src/checks');
const { GOOD_HTML, POOR_HTML, REPORT } = require('./fixtures');

const DAY = 24 * 60 * 60 * 1000;
const home = extract({ url: 'https://acme.test/', html: POOR_HTML, bytes: 100, responseMs: 200 });
const CRAWL = { home, subpages: [extract({ url: 'https://acme.test/about', html: GOOD_HTML, bytes: 100, responseMs: 200 })] };

// Minimal in-memory Stripe that keeps metadata like the real API (empty string unsets a key).
function fakeStripe({ sessions = [], subs = [] } = {}) {
  const pis = new Map();
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const refunds = [];
  const merge = (obj, metadata) => {
    for (const [k, v] of Object.entries(metadata)) if (v === '') delete obj.metadata[k]; else obj.metadata[k] = v;
    return obj;
  };
  return {
    refunds: { create: async (p) => { refunds.push(p); return {}; }, list: refunds },
    pis,
    paymentIntents: {
      retrieve: async (id) => pis.get(id),
      update: async (id, { metadata }) => merge(pis.get(id), metadata),
    },
    subscriptions: {
      update: async (id, { metadata }) => merge(subMap.get(id), metadata),
      list: async function* () { yield* subs; },
    },
    customers: { retrieve: async (id) => ({ id, email: `${id}@x.test` }) },
    checkout: { sessions: { list: async function* () { yield* sessions; } } },
  };
}

function fakeDeps(overrides = {}) {
  const sent = [];
  let t = Date.UTC(2026, 9, 12);
  return {
    sent,
    crawl: async () => CRAWL,
    generateReport: async () => REPORT,
    send: async (msg, key) => { sent.push({ ...msg, key }); },
    adminEmail: 'owner@x.test',
    linkSecret: 'secret',
    now: () => t,
    advance: (ms) => { t += ms; },
    ...overrides,
  };
}

const paidSession = (id = 'cs_1', pi = 'pi_1') => ({
  id, mode: 'payment', payment_status: 'paid', payment_intent: pi,
  metadata: { product: 'site-audit', website: 'https://acme.test/' }, customer_details: { email: 'buyer@x.test' },
});

test('one-time audit is delivered once and recorded on the PaymentIntent', async () => {
  const stripe = fakeStripe();
  stripe.pis.set('pi_1', { id: 'pi_1', metadata: { website: 'https://acme.test/' } });
  const deps = fakeDeps();

  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'delivered');
  assert.equal(deps.sent.length, 1);
  assert.equal(deps.sent[0].to, 'buyer@x.test');
  assert.equal(deps.sent[0].key, 'audit-pi_1');
  assert.match(deps.sent[0].subject, /scored 64\/100/);
  assert.ok(stripe.pis.get('pi_1').metadata.fulfilled_at);
  assert.equal(stripe.pis.get('pi_1').metadata.last_score, '64');

  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'already');
  assert.equal(deps.sent.length, 1);
});

test('a run in progress is not duplicated, but a stale claim is retried', async () => {
  const stripe = fakeStripe();
  const deps = fakeDeps();
  stripe.pis.set('pi_1', { id: 'pi_1', metadata: { website: 'https://acme.test/', claimed_at: String(deps.now()) } });
  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'in-progress');
  deps.advance(fulfill.CLAIM_TTL_MS + 1);
  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'delivered');
});

test('unreachable site is retried, then refunded automatically with an explanation', async () => {
  const stripe = fakeStripe();
  stripe.pis.set('pi_1', { id: 'pi_1', metadata: { website: 'https://acme.test/' } });
  const deps = fakeDeps({ crawl: async () => { throw new Error('The site returned HTTP 503.'); } });

  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'failed');
  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'failed');
  assert.equal(stripe.refunds.list.length, 0);
  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'refunded');
  assert.deepEqual(stripe.refunds.list, [{ payment_intent: 'pi_1', reason: 'requested_by_customer' }]);
  assert.match(deps.sent[0].subject, /refunded/);
  assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'already');
});

test('non-site failures (e.g. API outage) alert the owner instead of refunding', async () => {
  const stripe = fakeStripe();
  stripe.pis.set('pi_1', { id: 'pi_1', metadata: { website: 'https://acme.test/' } });
  const deps = fakeDeps({ generateReport: async () => { throw new Error('overloaded'); } });
  for (let i = 0; i < 4; i++) assert.equal(await fulfill.fulfillPayment(stripe, paidSession(), deps), 'failed');
  assert.equal(stripe.refunds.list.length, 0);
  const alerts = deps.sent.filter((m) => m.to === 'owner@x.test');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /Delivery failing/);
});

test('monthly plan: first report at signup, then only when due, with month-over-month score', async () => {
  const sub = { id: 'sub_1', status: 'active', customer: { id: 'cus_1', email: 'client@x.test' }, metadata: { website: 'https://acme.test/' } };
  const stripe = fakeStripe({ subs: [sub] });
  const deps = fakeDeps();
  const seen = [];
  deps.generateReport = async (input) => { seen.push(input.previous); return REPORT; };

  assert.equal(await fulfill.fulfillSubscription(stripe, sub, deps), 'delivered');
  assert.equal(seen[0], undefined);
  assert.match(deps.sent[0].html, /manage\?c=cus_1/);

  deps.advance(10 * DAY);
  assert.equal(await fulfill.fulfillSubscription(stripe, sub, deps), 'not-due');

  deps.advance(20 * DAY - 60 * 60 * 1000);
  assert.equal(await fulfill.fulfillSubscription(stripe, sub, deps), 'delivered');
  assert.deepEqual(seen[1], { score: 64, date: '2026-10-12' });
  assert.match(deps.sent[1].html, /\+0 since last month/);
  assert.notEqual(deps.sent[0].key, deps.sent[1].key);
});

test('reconcile only touches our completed audit sessions and due subscriptions', async () => {
  const other = { ...paidSession('cs_2', 'pi_2'), metadata: { product: 'something-else' } };
  const sub = { id: 'sub_1', status: 'active', customer: { id: 'cus_1', email: 'c@x.test' }, metadata: { website: 'https://acme.test/' } };
  const stripe = fakeStripe({ sessions: [paidSession(), other], subs: [sub] });
  stripe.pis.set('pi_1', { id: 'pi_1', metadata: { website: 'https://acme.test/' } });
  const deps = fakeDeps();
  const results = await fulfill.reconcile(stripe, { monitorPriceId: 'price_m' }, deps);
  assert.deepEqual(results, { payments: { delivered: 1 }, subscriptions: { delivered: 1 } });
  const again = await fulfill.reconcile(stripe, { monitorPriceId: 'price_m' }, deps);
  assert.deepEqual(again, { payments: { already: 1 }, subscriptions: { 'not-due': 1 } });
});

test('generateReport sends crawl evidence to Claude and handles refusals', async () => {
  const checks = runChecks(home);
  let request;
  const client = (resp) => ({ beta: { messages: { parse: async (req) => { request = req; return resp; } } } });
  const out = await generateReport({ crawl: CRAWL, checks }, client({ stop_reason: 'end_turn', parsed_output: REPORT }));
  assert.equal(out.overallScore, 64);
  assert.equal(request.fallbacks, 'default');
  const prompt = request.messages[0].content;
  assert.match(prompt, /https:\/\/acme\.test\//);
  assert.match(prompt, /FAIL: Clear call to action/);
  assert.match(prompt, /Fast, honest plumbing in Austin/); // subpage content included
  assert.match(buildPrompt({ crawl: CRAWL, checks, previous: { score: 50, date: '2026-09-12' } }), /scored 50\/100/);
  await assert.rejects(generateReport({ crawl: CRAWL, checks }, client({ stop_reason: 'refusal', stop_details: {} })), /declined/);
});

test('report and free-scan emails escape content and carry the right links', () => {
  const r = renderReport(REPORT, { brandName: 'B', siteUrl: 'https://acme.test/', date: '2026-10-12' });
  assert.match(r.html, /offer &lt;is&gt; buried/);
  assert.equal((r.html.match(/Finding \d/g) || []).length, 6);
  assert.match(r.text, /QUICK WINS/);

  const checks = runChecks(home);
  const scan = renderFreeScan(checks, { brandName: 'B', siteUrl: 'https://acme.test/', checkoutUrl: 'https://b.test/order?plan=audit&website=x' });
  assert.match(scan.subject, new RegExp(`${checks.score}/100`));
  assert.match(scan.html, /order\?plan=audit&amp;website=x/);
  assert.match(scan.html, /more automated issue/);
});
