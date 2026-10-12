// Web front of the consultancy: landing page, free scan (lead magnet), Stripe
// Checkout for the paid audit and monthly plan, signed manage links, and the
// Stripe webhook that kicks off delivery the moment someone pays.

const path = require('path');
const express = require('express');
const Stripe = require('stripe');
const config = require('./config');
const links = require('./links');
const { normalizeUrl, crawl } = require('./fetch-site');
const { runChecks } = require('./checks');
const { renderFreeScan, sendEmail, addContact } = require('./email');
const fulfill = require('./fulfill');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key, now = Date.now()) => {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10000) hits.clear(); // bound memory under abuse
    return true;
  };
}

function createApp({ stripe, env = process.env, deps = fulfill.defaultDeps(env), crawlSite = crawl, mailer = sendEmail } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const allowScan = rateLimiter(config.freeScansPerHour, 60 * 60 * 1000);

  // Delivery runs in the background so Stripe gets its 200 immediately; the
  // hourly worker retries anything that fails here.
  const deliver = (session) => {
    const job = session.mode === 'subscription'
      ? stripe.subscriptions.retrieve(session.subscription, { expand: ['customer'] }).then((sub) => fulfill.fulfillSubscription(stripe, sub, deps))
      : fulfill.fulfillPayment(stripe, session, deps);
    return job.then((outcome) => console.log(`Delivery for ${session.id}: ${outcome}`))
      .catch((err) => console.error(`Delivery for ${session.id} errored:`, err));
  };

  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (['site-audit', 'site-monitor'].includes(session.metadata?.product)) app.locals.lastDelivery = deliver(session);
    }
    res.json({ received: true });
  });

  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get('/healthz', (req, res) => res.send('ok'));

  const orderUrl = (plan, website, email) => {
    const params = new URLSearchParams({ plan, website });
    if (email) params.set('email', email);
    return `${config.baseUrl}/order?${params}`;
  };

  app.post('/scan', async (req, res) => {
    const email = String(req.body.email || '').trim();
    let site;
    try {
      site = normalizeUrl(req.body.website);
      if (!EMAIL_RE.test(email)) throw new Error('Please enter a valid email address.');
    } catch (err) {
      return res.status(400).send(page('Check your details', `<p>${escape(err.message)}</p><p><a href="/">Go back</a></p>`));
    }
    if (!allowScan(req.ip)) {
      return res.status(429).send(page('Slow down', '<p>Too many scans from your network. Please try again in an hour.</p>'));
    }
    try {
      const crawled = await crawlSite(site.toString());
      const checks = runChecks(crawled.home);
      const scan = renderFreeScan(checks, {
        brandName: config.brandName, siteUrl: crawled.home.url, checkoutUrl: orderUrl('audit', crawled.home.url, email),
      });
      Promise.all([
        mailer({ to: email, ...scan }, { apiKey: env.RESEND_API_KEY, from: config.fromEmail, replyTo: config.replyTo }),
        addContact(email, { apiKey: env.RESEND_API_KEY, audienceId: env.RESEND_AUDIENCE_ID }),
      ]).catch((err) => console.error('Free scan email failed:', err));
      res.send(scan.html);
    } catch (err) {
      res.status(422).send(page('We couldn\'t scan that site', `<p>${escape(err.message)}</p><p><a href="/">Try another address</a></p>`));
    }
  });

  app.all('/order', async (req, res, next) => {
    const input = { ...req.query, ...(req.body || {}) };
    const plan = input.plan === 'monitor' ? 'monitor' : 'audit';
    let website;
    try {
      website = normalizeUrl(input.website).toString();
    } catch (err) {
      return res.status(400).send(page('Check the website address', `<p>${escape(err.message)}</p><p><a href="/">Go back</a></p>`));
    }
    const email = EMAIL_RE.test(String(input.email || '')) ? String(input.email) : undefined;
    try {
      const common = {
        customer_email: email,
        allow_promotion_codes: true,
        success_url: `${config.baseUrl}/thanks.html`,
        cancel_url: `${config.baseUrl}/`,
      };
      const session = plan === 'monitor'
        ? await stripe.checkout.sessions.create({
          ...common,
          mode: 'subscription',
          line_items: [{ price: env.MONITOR_PRICE_ID, quantity: 1 }],
          metadata: { product: 'site-monitor', website },
          subscription_data: { metadata: { website } },
        })
        : await stripe.checkout.sessions.create({
          ...common,
          mode: 'payment',
          customer_creation: 'always',
          line_items: [{ price: env.AUDIT_PRICE_ID, quantity: 1 }],
          metadata: { product: 'site-audit', website },
          payment_intent_data: { metadata: { website } },
        });
      res.redirect(303, session.url);
    } catch (err) {
      next(err);
    }
  });

  app.get('/manage', async (req, res, next) => {
    const { c, s } = req.query;
    if (!env.LINK_SECRET || !links.verify(c, s, env.LINK_SECRET)) {
      return res.status(403).send(page('Invalid link', '<p>Use the link at the bottom of any report email from us.</p>'));
    }
    try {
      const portal = await stripe.billingPortal.sessions.create({ customer: c, return_url: `${config.baseUrl}/` });
      res.redirect(303, portal.url);
    } catch (err) {
      next(err);
    }
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send(page('Something went wrong', '<p>Please try again in a moment.</p>'));
  });

  return app;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="/styles.css"></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
}

if (require.main === module) {
  const stripe = new Stripe(config.required('STRIPE_SECRET_KEY'));
  for (const name of ['AUDIT_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'LINK_SECRET', 'ANTHROPIC_API_KEY']) config.required(name);
  createApp({ stripe }).listen(config.port, () => console.log(`${config.brandName} listening on ${config.port}`));
}

module.exports = { createApp, rateLimiter };
