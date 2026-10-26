# Dibiasio Realty — Online Rental Applications

A branded application portal for Dibiasio Realty. Applicants fill out one of three
applications on their phone or computer, e-sign, and upload their ID, pay stubs and
other documents. Agents get a dashboard with every application, a document checklist,
a deal sheet, credit-report tracking, and a printable / PDF package for the landlord.

## The three applications

| Link | Based on | Notes |
|---|---|---|
| `/apply?f=beantown` | Beantown Companies Rental Application (Rev 12/2025) | One application per household, up to 6 members, other-adult signatures |
| `/apply?f=hamilton` | The Hamilton Company Lease Application + checklist + verification request | One per adult; includes release authorization, student and lead-paint questions, and a 2.5× income check |
| `/apply?f=standard` | Dibiasio Realty standard rental application | One per adult; for all other landlords |

Every question from the original paper forms is captured, regrouped into short
mobile-friendly steps. The fields are defined in `public/js/forms.js`, so to add or
change a question you edit one file.

## How agents use it

1. **New applicant link** (dashboard → *New link*): choose the application and enter
   the apartment (address, unit, rent, move-in…). Copy, text or email the link. The
   applicant sees the apartment and agent at the top, and those fields come pre-filled.
2. Applicants who use the same link (roommates / co-applicants) are grouped into one **deal**.
3. You get an email (if SMTP is configured), and the deal shows:
   - each applicant's full application (SSN masked unless you choose *Show full SSN*), signature and consents
   - a **document checklist** showing what's missing, with one-tap "please upload" messages
     that include the applicant's private upload link
   - **income ÷ rent**, move-in total and balance due
   - **credit report** status (Not requested / Requested / Received / Waived), score, notes and the report itself
   - the **deal sheet** (property, lease terms, move-in costs, broker fee, commission, plus
     Hamilton/Beantown/standard-specific office fields)
   - an activity log
4. **Print / PDF** builds a branded package for the landlord. You can include or leave out
   the full SSN, the deal sheet, and commission details.

Each agent also has personal links (*Team* page) to post on listings. Anyone who
applies through them is assigned to that agent automatically.

## Original landlord forms

Each applicant card in the dashboard has a **form (PDF)** button. It prints the applicant's answers,
signature and the deal-sheet terms onto the landlord's original paper form (`templates/*.pdf`:
Beantown, Hamilton, or the standard e-FORMS application). The field positions live in
`lib/original.js`; if a landlord revises their form, replace the template and adjust the positions.

**Landlord package:** *Form + documents (PDF)* on an applicant card, or *Landlord package (PDF)*
at the top of a deal for every applicant at once, merges the original form(s) with the uploaded
documents (ID, pay stubs, tax return, …) into one PDF. Photos (JPEG, PNG, HEIC, WebP, GIF, TIFF)
are turned upright and converted to PDF pages; Word documents get a placeholder page. Credit
reports are left out unless `?credit=1` is added. Any photo can also be opened alone as a PDF.

## Health notices

The dashboard shows a notice when the storage disk passes 80% (yellow) or 95% (red), and emails
an alert the first time each level is reached (`STORAGE_WARN_PCT` / `STORAGE_CRITICAL_PCT` change
the thresholds). It also lists every alert that failed to send, linked to the application it was
about, so a new application can't go unnoticed; agents dismiss the list once they've checked.
A submission that can't be saved because the disk is full is recorded the same way.

## Email

With `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS` set (see `.env.example`), the portal sends mail
from the company mailbox (`MAIL_FROM_ADDRESS`, e.g. james@dibiasiorealty.com):

- alerts to the assigned agent when an application or new documents arrive (copied to `NOTIFY_EMAIL`)
- the dashboard's **Email** buttons (applicant link, "please upload" requests, credit-check
  requests, free-form messages). These go out as "Agent Name | Dibiasio Realty" and replies go to
  the agent's own address. Each one is logged on the deal.

**Alerts without SMTP (Resend):** sign up at resend.com with the address that should receive
alerts and set `RESEND_API_KEY`. Each new application or document upload is emailed to
`RESEND_TO` (default `NOTIFY_EMAIL`). Without a verified domain, Resend only delivers to the
account owner's address, so other agents see new applications in the dashboard.

**Alerts via ntfy:** set `NTFY_TOPIC` to a long random name. Each new application or
document upload then sends a notification to the free ntfy phone app (subscribe to that
topic), and ntfy forwards it by email to the assigned agent (and `NOTIFY_EMAIL`). Only the
application type, property and a dashboard link go through ntfy, never applicant details.

Without SMTP, the Email buttons open a pre-filled draft in the agent's own mail app, or in Gmail
in the browser when `EMAIL_COMPOSE=gmail` (signed in as the agent's address), so mail still comes from their own account.

## Credit reports

Pulling a consumer credit report requires an account with a tenant-screening provider
(consumer reporting agency), plus FCRA permissible purpose. The portal does **not**
pull credit itself. It handles the rest of the workflow:

- Every application includes the applicant's written authorization for a credit (and, for
  Beantown, CORI) check.
- Set `CREDIT_SCREENING_URL` to your provider's applicant link (for example TransUnion
  SmartMove, RentSpree or MyRental). Applicants see a **Start credit check** button
  right after submitting and on their status page, and agents can send the request in one tap.
- When the report arrives, upload it on the applicant's card. The status changes to *Received*.

If you later sign a screening partner with an API (e.g. TransUnion ShareAble), the
hook to add it is `PUT /api/apps/:id/credit` in `server.js`.

## Running it

```bash
cd dibiasio-apply
cp .env.example .env      # set DATA_KEY, ADMIN_EMAIL / ADMIN_PASSWORD, etc.
npm install
npm start                 # http://localhost:5050
npm test                  # end-to-end API tests
```

On first visit to `/agent`, the dashboard asks you to create an admin account (unless
`ADMIN_EMAIL`/`ADMIN_PASSWORD` are set). Add your agents from the *Team* page.

### Deploying (to get a public link)

`render.yaml` deploys to Render with a persistent disk (Starter plan, about $7/mo, plus disk).
Any Node host with a persistent disk and HTTPS will also work. In production:

- Set `NODE_ENV=production`, `PUBLIC_URL=https://apply.dibiasiorealty.com` (or similar),
  and a `DATA_KEY` that you **back up** — without it, stored data can't be decrypted.
- Point a subdomain such as `apply.dibiasiorealty.com` at the service and link to it from your website.

## Security & privacy

- Applicant answers (SSN, DOB, signatures…) and every uploaded document are encrypted
  at rest with AES-256-GCM. Applicants never see other applicants' data. Their private
  status link can only add documents, not read the application back.
- SSNs, ITINs and account numbers are never saved in the browser's draft.
- The standard application asks only for the last 4 digits of bank accounts.
- Agent passwords are scrypt-hashed. Sessions use HttpOnly, SameSite cookies, and
  logins and submissions are rate-limited.
- Uploads are limited to PDF, images and Word documents, 20 MB each.
- The forms include Massachusetts fair-housing language and the sealed-record notice. Have
  your attorney review the certification text before you go live.
