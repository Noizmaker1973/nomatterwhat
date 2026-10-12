# One Day Daily: an automated subscription business

A paid daily email: each morning, subscribers get a short recovery reflection
written by Claude, with one small action for the day and an affirmation.
**$5/month after a 7-day free trial.**

Once it is deployed, it runs without you:

| What happens | Who does it |
|---|---|
| Visitor lands on the page, starts a trial | Landing page → Stripe Checkout |
| Card is charged monthly; failed cards are retried and dunned | Stripe Billing |
| Welcome email on signup | Stripe webhook → this app → Resend |
| A new reflection is written every morning | Daily cron → Claude API (one call per day, whatever the subscriber count) |
| Reflection is emailed to every active/trialing subscriber | Daily cron → Resend batch API |
| Cancel, change card, see invoices | One-click signed link in every email → Stripe Customer Portal |

There is no database to run. Stripe is the subscriber list: cancel in Stripe and
the person stops getting emails on the next run.

## Running costs

| Item | Cost |
|---|---|
| Render web service + cron (starter) | ~$7 + ~$1/month |
| Claude API, one reflection a day | well under $1/month |
| Resend | free up to 3,000 emails/month (~100 subscribers), then $20/month |
| Stripe | 2.9% + 30¢ per charge |

At $5/month, Stripe fees take about 45¢ per subscriber and the fixed costs are covered
by roughly 3 subscribers. Every subscriber after that is mostly margin. Check the
providers' current pricing, since these figures change.

## One-time setup (about an hour)

You need four accounts. These steps can't be automated for you because each
provider ties the account to you personally.

1. **Anthropic**: create an API key at console.anthropic.com.
2. **Stripe**:
   - Create a Product "One Day Daily" with a recurring price of $5/month. Copy the price id (`price_...`).
   - Settings → Billing → Customer portal: turn it on and allow cancelling and updating payment methods.
   - Settings → Billing → Subscriptions and emails: turn on failed-payment retries and emails.
3. **Resend**: add and verify your sending domain (DNS records), then create an API key.
   Set `FROM_EMAIL` to an address on that domain.
4. **Render**: push this repo, then New → Blueprint and choose the repo. It reads
   `render.yaml` at the repo root and creates the web service, the daily cron job, and an
   env var group. Fill in the blank variables (see `.env.example`).
5. **Stripe webhook**: Developers → Webhooks → add endpoint
   `https://<your-render-url>/webhooks/stripe` for the event `checkout.session.completed`.
   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
6. Set `BASE_URL` to your public URL (Render URL or your own domain).

Test it end to end in Stripe test mode first (card `4242 4242 4242 4242`), then
swap in live keys.

## Local development

```bash
cd business
npm install
cp .env.example .env     # fill in values
npm test                 # unit + HTTP tests, no network needed
node --env-file=.env src/server.js                       # http://localhost:4000
DRY_RUN=1 node --env-file=.env src/send-daily.js         # generate today's email and print it, send nothing
```

Use `stripe listen --forward-to localhost:4000/webhooks/stripe` to receive webhooks locally.

## Customization

- **Price and trial**: price is set in Stripe; trial length is `TRIAL_DAYS`. Update the
  copy in `public/index.html` to match.
- **Send time**: `schedule` in the repo-root `render.yaml` (UTC).
- **Voice and content**: `SYSTEM_PROMPT` in `src/content.js`.
- **Another niche**: the same machinery works for any daily-email product. Change the
  prompt, the schema in `src/content.js`, and the landing page.

## What still needs a person

The software runs on its own. Getting subscribers is the part that does not:

- **Traffic.** A landing page nobody visits makes no money. Low-cost channels for this
  niche: a free weekly version or sample archive for search traffic, recovery
  communities on Reddit and Facebook (follow each group's self-promotion rules),
  and partnerships with sober-living homes and treatment alumni programs.
- **Inbox check-ins.** Glance at replies and Stripe disputes now and then. Render emails
  you if the cron job fails.
- **Legal basics.** Add a privacy policy and terms page, and a physical mailing address
  in the email footer (CAN-SPAM). Keep the "not a substitute for treatment" disclaimer.

## Files

```
business/              (render.yaml lives at the repo root)
├── public/              # Landing page and post-checkout page
├── src/
│   ├── server.js        # Checkout, manage link, Stripe webhook
│   ├── send-daily.js    # Daily job: generate + send
│   ├── content.js       # Claude prompt and structured output
│   ├── email.js         # Email template + Resend batch sending
│   ├── subscribers.js   # Active subscribers from Stripe
│   ├── links.js         # HMAC-signed manage-subscription links
│   └── config.js
└── test/
```
