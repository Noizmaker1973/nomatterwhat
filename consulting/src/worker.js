// Hourly job: deliver any paid audit that hasn't gone out yet and any monthly
// report that's due. Safe to run as often as you like; Stripe metadata
// records what's been delivered.

const Stripe = require('stripe');
const config = require('./config');
const { reconcile, defaultDeps } = require('./fulfill');

async function main() {
  const stripe = new Stripe(config.required('STRIPE_SECRET_KEY'));
  config.required('RESEND_API_KEY');
  const results = await reconcile(stripe, { monitorPriceId: process.env.MONITOR_PRICE_ID }, defaultDeps());
  console.log('Reconcile results:', JSON.stringify(results));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
