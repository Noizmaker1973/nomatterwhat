// Delivers audits. Stripe is the system of record: what was bought and the
// site URL live on the PaymentIntent (one-time audit) or Subscription (monthly
// plan) metadata, along with when a report was last delivered. That lets the
// webhook deliver instantly and an hourly worker sweep up anything missed,
// without a database and without double-delivering.

const config = require('./config');
const { crawl: crawlSite } = require('./fetch-site');
const { runChecks } = require('./checks');
const { generateReport } = require('./report');
const { renderReport, sendEmail } = require('./email');
const links = require('./links');

const CLAIM_TTL_MS = 30 * 60 * 1000; // a run that hasn't finished in 30 min is presumed dead
const MAX_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

class SiteError extends Error {}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDeps(env = process.env) {
  return {
    crawl: crawlSite,
    generateReport,
    send: (message, idempotencyKey) => sendEmail(message, {
      apiKey: env.RESEND_API_KEY, from: config.fromEmail, replyTo: config.replyTo, idempotencyKey,
    }),
    adminEmail: env.ADMIN_EMAIL,
    linkSecret: env.LINK_SECRET,
    now: () => Date.now(),
  };
}

async function produceAndSend({ website, email, previous, manageUrl, idempotencyKey }, deps) {
  let crawled;
  try {
    crawled = await deps.crawl(website);
  } catch (err) {
    throw new SiteError(err.message);
  }
  const checks = runChecks(crawled.home);
  const report = await deps.generateReport({ crawl: crawled, checks, previous });
  const message = renderReport(report, {
    brandName: config.brandName, siteUrl: crawled.home.url, date: today(), manageUrl, previousScore: previous?.score,
  });
  await deps.send({ to: email, ...message }, idempotencyKey);
  return report.overallScore;
}

function isClaimed(metadata, now) {
  return metadata.claimed_at && now - Number(metadata.claimed_at) < CLAIM_TTL_MS;
}

async function notifyAdmin(deps, subject, text) {
  if (!deps.adminEmail) return;
  try {
    await deps.send({ to: deps.adminEmail, subject: `[${config.brandName}] ${subject}`, text });
  } catch (err) {
    console.error('Admin notification failed:', err);
  }
}

// Shared claim → produce → record cycle for both product types.
async function runDelivery({ metadata, update, job, onSiteFailure, label }, deps) {
  const now = deps.now();
  if (isClaimed(metadata, now)) return 'in-progress';
  const attempts = Number(metadata.attempts || 0) + 1;
  await update({ claimed_at: String(now), attempts: String(attempts) });
  try {
    const score = await produceAndSend(job, deps);
    await update({ claimed_at: '', attempts: '0', last_report_at: String(deps.now()), last_score: String(score), fulfilled_at: String(deps.now()) });
    return 'delivered';
  } catch (err) {
    console.error(`Delivery failed for ${label} (attempt ${attempts}):`, err);
    await update({ claimed_at: '' });
    if (attempts >= MAX_ATTEMPTS) {
      if (err instanceof SiteError && onSiteFailure) {
        await onSiteFailure(err);
        await update({ fulfilled_at: 'failed' });
        return 'refunded';
      }
      if (attempts === MAX_ATTEMPTS) await notifyAdmin(deps, `Delivery failing: ${label}`, `${err.stack || err}`);
    }
    return 'failed';
  }
}

// One-time audit, from a completed Checkout Session in payment mode.
async function fulfillPayment(stripe, session, deps) {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return 'not-paid';
  const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
  if (pi.metadata.fulfilled_at) return 'already';
  const email = session.customer_details?.email;
  const website = pi.metadata.website;
  return runDelivery({
    label: `payment ${pi.id} (${website})`,
    metadata: pi.metadata,
    update: (metadata) => stripe.paymentIntents.update(pi.id, { metadata }),
    job: { website, email, idempotencyKey: `audit-${pi.id}` },
    onSiteFailure: async (err) => {
      await stripe.refunds.create({ payment_intent: pi.id, reason: 'requested_by_customer' });
      await deps.send({
        to: email,
        subject: `We couldn't reach ${website}, so we've refunded you`,
        text: `We tried several times to audit ${website} but couldn't load it (${err.message}).\n\nYour payment has been refunded in full. If the address was mistyped or the site was temporarily down, you're welcome to order again at ${config.baseUrl}.`,
      }, `refund-${pi.id}`);
    },
  }, deps);
}

// Monthly plan: first report right after signup, then every MONITOR_INTERVAL_DAYS.
async function fulfillSubscription(stripe, sub, deps) {
  if (!['active', 'trialing'].includes(sub.status)) return 'inactive';
  const meta = sub.metadata || {};
  const now = deps.now();
  const last = Number(meta.last_report_at || 0);
  // Leave a little slack so an hourly worker doesn't drift a day later each month.
  if (last && now - last < config.monitorIntervalDays * DAY_MS - 2 * 60 * 60 * 1000) return 'not-due';
  const customer = typeof sub.customer === 'string' ? await stripe.customers.retrieve(sub.customer) : sub.customer;
  if (!customer || customer.deleted || !customer.email) return 'no-email';
  const period = new Date(now).toISOString().slice(0, 10);
  return runDelivery({
    label: `subscription ${sub.id} (${meta.website})`,
    metadata: meta,
    update: (metadata) => stripe.subscriptions.update(sub.id, { metadata }),
    job: {
      website: meta.website,
      email: customer.email,
      previous: last ? { score: Number(meta.last_score), date: new Date(last).toISOString().slice(0, 10) } : undefined,
      manageUrl: deps.linkSecret ? links.manageUrl(config.baseUrl, customer.id, deps.linkSecret) : undefined,
      idempotencyKey: `monitor-${sub.id}-${period}`,
    },
  }, deps);
}

// Hourly sweep: deliver any paid one-time audit not yet fulfilled (e.g. the
// webhook was missed or the server restarted mid-run), and any monthly report due.
async function reconcile(stripe, { monitorPriceId }, deps) {
  const results = { payments: {}, subscriptions: {} };
  const tally = (bucket, outcome) => { bucket[outcome] = (bucket[outcome] || 0) + 1; };

  const since = Math.floor((deps.now() - 3 * DAY_MS) / 1000);
  for await (const session of stripe.checkout.sessions.list({ created: { gte: since }, status: 'complete', limit: 100 })) {
    if (session.metadata?.product !== 'site-audit' || session.mode !== 'payment') continue;
    tally(results.payments, await fulfillPayment(stripe, session, deps));
  }

  if (monitorPriceId) {
    for await (const sub of stripe.subscriptions.list({ status: 'active', price: monitorPriceId, limit: 100, expand: ['data.customer'] })) {
      tally(results.subscriptions, await fulfillSubscription(stripe, sub, deps));
    }
  }
  return results;
}

module.exports = { fulfillPayment, fulfillSubscription, reconcile, produceAndSend, defaultDeps, SiteError, CLAIM_TTL_MS, MAX_ATTEMPTS };
