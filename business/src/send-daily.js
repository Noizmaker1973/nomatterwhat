// Daily job, run once a day by the scheduler (Render cron in render.yaml):
// generate today's reflection, then email it to every paying/trialing subscriber.
//
//   DRY_RUN=1 node src/send-daily.js   # generate and print, send nothing

const Stripe = require('stripe');
const config = require('./config');
const { generateReflection } = require('./content');
const { renderEmail, sendBatch } = require('./email');
const { listSubscribers } = require('./subscribers');
const { manageUrl } = require('./links');

async function run({ dryRun = process.env.DRY_RUN === '1', now = new Date() } = {}) {
  const reflection = await generateReflection(now);
  console.log(`Generated: "${reflection.title}" (${reflection.theme})`);

  if (dryRun) {
    const preview = renderEmail(reflection, { brandName: config.brandName, manageUrl: `${config.baseUrl}/manage` });
    console.log(`\n${preview.subject}\n\n${preview.text}`);
    return { sent: 0, dryRun: true };
  }

  const stripe = new Stripe(config.required('STRIPE_SECRET_KEY'));
  const linkSecret = config.required('LINK_SECRET');
  const subscribers = await listSubscribers(stripe, process.env.STRIPE_PRICE_ID);
  console.log(`Subscribers to email: ${subscribers.length}`);
  if (subscribers.length === 0) return { sent: 0 };

  const messages = subscribers.map((s) => ({
    to: s.email,
    ...renderEmail(reflection, {
      brandName: config.brandName,
      manageUrl: manageUrl(config.baseUrl, s.customerId, linkSecret),
    }),
  }));

  const sent = await sendBatch(messages, {
    apiKey: config.required('RESEND_API_KEY'),
    from: config.fromEmail,
    idempotencyPrefix: `daily-${now.toISOString().slice(0, 10)}`,
  });
  console.log(`Sent ${sent} emails.`);
  return { sent };
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1); // non-zero exit makes the scheduler mark the run failed
  });
}

module.exports = { run };
