// Web front of the business: landing page, Stripe Checkout, the one-click
// manage-subscription link, and the Stripe webhook that sends a welcome email.

const path = require('path');
const express = require('express');
const Stripe = require('stripe');
const config = require('./config');
const links = require('./links');
const { sendBatch, escapeHtml } = require('./email');

function welcomeEmail(manageUrl) {
  const text = `Welcome to ${config.brandName}.\n\nYour first reflection arrives tomorrow morning, and every morning after that. Your ${config.trialDays}-day free trial has started; you won't be charged until it ends, and you can cancel any time.\n\nManage or cancel: ${manageUrl}\n\nIf you are in crisis: call or text 988, or call SAMHSA at 1-800-662-4357.`;
  const html = `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#2b2b2b">
<h1 style="font-size:26px">Welcome to ${escapeHtml(config.brandName)}</h1>
<p>Your first reflection arrives tomorrow morning, and every morning after that.</p>
<p>Your ${config.trialDays}-day free trial has started. You won't be charged until it ends, and you can cancel any time.</p>
<p><a href="${escapeHtml(manageUrl)}" style="color:#3f7d6e">Manage or cancel your subscription</a></p>
<p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#666">If you are in crisis: call or text 988, or call SAMHSA at 1-800-662-4357.</p></div>`;
  return { subject: `Welcome to ${config.brandName}`, text, html };
}

function createApp({ stripe, env = process.env, send = sendBatch } = {}) {
  const app = express();
  const linkSecret = env.LINK_SECRET;

  // Webhook needs the raw body for signature verification, so it is registered
  // before any body parser.
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details && session.customer_details.email;
      if (email && session.customer) {
        try {
          await send([{ to: email, ...welcomeEmail(links.manageUrl(config.baseUrl, session.customer, linkSecret)) }], {
            apiKey: env.RESEND_API_KEY,
            from: config.fromEmail,
            idempotencyPrefix: `welcome-${session.id}`,
          });
        } catch (err) {
          // Stripe retries on non-2xx; the idempotency key prevents duplicates.
          console.error('Welcome email failed:', err);
          return res.status(500).send('welcome email failed');
        }
      }
    }
    res.json({ received: true });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/healthz', (req, res) => res.send('ok'));

  app.post('/checkout', async (req, res, next) => {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
        subscription_data: config.trialDays > 0 ? { trial_period_days: config.trialDays } : undefined,
        allow_promotion_codes: true,
        success_url: `${config.baseUrl}/welcome.html`,
        cancel_url: `${config.baseUrl}/`,
      });
      res.redirect(303, session.url);
    } catch (err) {
      next(err);
    }
  });

  app.get('/manage', async (req, res, next) => {
    const { c, s } = req.query;
    if (!linkSecret || !links.verify(c, s, linkSecret)) {
      return res.status(403).send('This link is invalid. Use the link at the bottom of any email from us.');
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
    res.status(500).send('Something went wrong. Please try again in a moment.');
  });

  return app;
}

if (require.main === module) {
  const stripe = new Stripe(config.required('STRIPE_SECRET_KEY'));
  for (const name of ['STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET', 'LINK_SECRET', 'RESEND_API_KEY']) config.required(name);
  createApp({ stripe }).listen(config.port, () => console.log(`${config.brandName} listening on ${config.port}`));
}

module.exports = { createApp, welcomeEmail };
