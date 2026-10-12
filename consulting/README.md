# ClearPath Audits: an automated B2B website-audit consultancy

Small businesses pay for a consultant-grade audit of their website's conversion
and SEO: what's costing them leads, with evidence, specific fixes, rewritten headline
copy and a 90-day plan. Every step from first visit to delivered report runs without you.

| Offer | Price | What they get |
|---|---|---|
| Free scan (lead magnet) | $0 | 14-point automated score + top 3 issues, by email |
| **Full Website Audit** | **$297 once** | Full report across 6 areas, delivered in ~15 minutes |
| **Growth Partner** | **$199/month** | A fresh audit every month with score tracking |

## How it runs on its own

```
Visitor ─► free scan ─► score + top 3 issues emailed ─► "Get the full audit" link
                                                             │
                     Stripe Checkout ($297 or $199/mo) ◄─────┘
                             │ webhook
                             ▼
     crawl homepage + key pages ─► 14 automated checks ─► Claude writes the audit
                             │
                             ▼
              report emailed (Resend) ─► delivery recorded on the Stripe payment
```

- **Instant delivery**: the Stripe webhook starts the audit the moment payment clears.
- **Self-healing**: an hourly worker delivers anything the webhook missed (server
  restart, API hiccup) and sends Growth Partner reports when they're due.
- **No double delivery**: delivery state is stored in Stripe metadata, plus email
  idempotency keys.
- **Automatic refunds**: if the customer's site can't be reached after 3 tries, they're
  refunded and told why. If something else breaks (e.g. an API outage), you get one
  alert email and it keeps retrying.
- **Self-serve cancellations**: every monthly report has a signed one-click link to
  Stripe's billing portal.
- **No database**: Stripe holds customers, payments, and delivery state.

## The $1,000/week math

$1,000/week is about $4,330/month. Some ways to get there:

| Mix | Monthly revenue |
|---|---|
| 15 one-time audits per month (about 3–4 a week) | $4,455 |
| 22 Growth Partner subscribers | $4,378 |
| 8 audits + 10 subscribers | $4,366 |

Costs at that volume: about $16/month hosting (Render web + cron), well under $1 of
Claude API per audit, Resend free to $20/month, and Stripe at 2.9% + 30¢ per charge
(about $9 per audit, $6 per subscription). Margin is above 90%.

**Be realistic:** the software won't find customers by itself. Revenue depends on
getting about 400–800 business owners a month to run the free scan, assuming a
typical 2–4% scan-to-purchase rate. That rate is an estimate; measure your own.
Subscribers accumulate, so the monthly plan is what gets you past $1,000/week
and keeps you there.

## Getting customers (the part that needs you, at first)

Ranked by cost and how well it fits this product:

1. **Google Ads on buying-intent searches** ("website audit", "why isn't my website
   getting leads", "conversion audit"). Point ads at the free scan. Start at $20–30/day
   and keep only keywords that produce paid audits.
2. **Partnerships and white-label.** Web designers, marketing agencies, and business
   coaches resell audits to their clients. Give them a Stripe promotion code (the
   checkout accepts codes) or a referral cut. One agency can bring you dozens of sales.
3. **LinkedIn and local groups.** Post one anonymized "teardown" per week from a real
   report. Chambers of commerce and BNI groups are full of owners with weak websites.
4. **Personal outreach to businesses you've scanned yourself.** Run the free scan on a
   prospect's site and send a short, personal note with their top issue. Keep it
   one-to-one and CAN-SPAM compliant (real address, opt-out). Don't automate bulk cold
   email; it gets domains blacklisted.
5. **Follow-up broadcasts.** Set `RESEND_AUDIENCE_ID` and free-scan leads are collected
   for monthly tips emails that point back to the paid audit.

## One-time setup (about an hour)

1. **Anthropic**: create an API key at console.anthropic.com and add billing.
2. **Stripe**:
   - Create a product "Full Website Audit" with a one-time $297 price → `AUDIT_PRICE_ID`.
   - Create a product "Growth Partner" with a recurring $199/month price → `MONITOR_PRICE_ID`.
   - Turn on the Customer portal (Settings → Billing → Customer portal) with cancellation allowed.
3. **Resend**: verify your sending domain, then create an API key. Optionally create an
   audience for leads → `RESEND_AUDIENCE_ID`.
4. **Render**: New → Blueprint → choose this repo. `render.yaml` at the repo root
   creates `clearpath-audits-web` and the hourly `clearpath-audits-worker`. Fill in the
   `clearpath-audits` env group (see `.env.example`). Delete the One Day Daily services
   if you aren't running that business.
5. **Stripe webhook**: add endpoint `https://<your-url>/webhooks/stripe` for
   `checkout.session.completed` → `STRIPE_WEBHOOK_SECRET`.
6. Point your domain at the Render web service and set `BASE_URL`.

Before going live, buy an audit of your own site in Stripe test mode (card
`4242 4242 4242 4242`) and read the report end to end.

## Local development

```bash
cd consulting
npm install
cp .env.example .env
npm test                                   # 20 tests, no network or keys needed
node src/dry-run.js yoursite.com           # free scan in the terminal
node --env-file=.env src/dry-run.js yoursite.com --full   # full Claude audit → report.html
node --env-file=.env src/server.js         # http://localhost:4100
stripe listen --forward-to localhost:4100/webhooks/stripe
```

## Customizing

- **Brand and prices**: `BRAND_NAME` env var. Set prices in Stripe, then match the copy
  in `public/index.html`.
- **Niche it**: auditing one industry (dentists, law firms, roofers, SaaS) converts
  better than "small businesses." Change the landing copy and add the niche's
  conversion norms to `SYSTEM_PROMPT` in `src/report.js`.
- **Checks**: add or reweight in `src/checks.js`.

## Running it

- Render emails you if the worker fails, and `ADMIN_EMAIL` gets an alert for repeated
  delivery failures.
- Replies to reports go to `REPLY_TO`. Answering them is optional, but it's also where
  upsells come from (implementation work, referrals).
- Add a privacy policy and terms page before running ads. Most ad platforms require them.

## Security notes

Customers supply the URLs we crawl, so `src/fetch-site.js` only fetches public
http(s) sites on standard ports. It checks every redirect hop's DNS against
private/internal ranges, caps response size and time, and the free scan is
rate-limited per IP. Stripe webhooks are signature-verified, and manage links are
HMAC-signed.

## Files

```
consulting/
├── public/             Landing page, thank-you page, styles
├── src/
│   ├── server.js       Free scan, checkout, manage link, Stripe webhook
│   ├── worker.js       Hourly sweep (missed deliveries + monthly reports)
│   ├── fulfill.js      Delivery state machine on Stripe metadata, refunds, alerts
│   ├── fetch-site.js   Safe crawler + page fact extraction
│   ├── checks.js       14 weighted automated checks (free scan score)
│   ├── report.js       Claude prompt + structured report schema
│   ├── email.js        Report / free-scan email templates, Resend
│   ├── links.js        Signed manage-subscription links
│   └── dry-run.js      Try it from the terminal
└── test/
```
