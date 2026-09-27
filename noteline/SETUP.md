# NoteLine — find lenders likely to sell non-performing notes

Deedline finds properties. NoteLine finds **lenders**: the banks, credit unions and
private lenders carrying non-performing loans who have a reason to sell them, with
the loan types and, where Deedline has them, the addresses.

Every Monday morning it:

1. Pulls the latest **FDIC call reports** for every bank in your states (MA, NH, RI,
   CT, ME and VT by default). Every insured bank reports each quarter how much of its
   book is 90+ days late or on nonaccrual, split by home loans, commercial real estate
   and business loans. The **NCUA call reports** do the same for credit unions.
2. Reads **Deedline's Land Court filings** and groups them by plaintiff. A bank or
   private lender foreclosing in its own name holds that exact bad note right now.
3. Optionally reads the **SBA 7(a)/504 loan file** for business-loan charge-offs.
4. Finds **proven sellers**: lenders with a record of actually selling notes, from
   Registry assignment records, foreclosures refiled by a new owner partway through,
   and court captions.
5. Prices the notes lenders are foreclosing on now: assessed value from MassGIS,
   less costs, over a Massachusetts foreclosure timeline measured from the court's
   own filings.
6. Scores each lender, writes a **call brief** and first-contact letter for each one
   worth calling, and emails you the list with an interactive dashboard attached.
   Same as Deedline. A private Google web app adds your tracker: statuses,
   follow-ups, contacts and notes.

It's standard-library Python. There's nothing to install and it costs nothing to run.

---

## What the score is built from

| Signal | Why it matters |
|---|---|
| Noncurrent loan ratio | The size of the pile. Over 2.5% is high for a community bank. |
| Change over a year | Rising trouble means rising pressure to clear it. |
| 30–89 days late | Loans that will be noncurrent next quarter. |
| Texas ratio | Bad loans + foreclosed property ÷ capital + reserves. Over 50% means real pressure. |
| Thin capital, losses | Selling bad loans frees capital. That's often the reason a bank sells. |
| Size | $100M–$10B banks sell single notes and small pools by phone. Money-center banks only sell big pools at auction. |
| MA foreclosures (Deedline) | Specific notes you can name when you call. |
| Proven seller | It has sold notes before. The strongest signal on the list. |
| SBA charge-offs | Business loans the lender is writing off now. |

Servicers (PennyMac, Rocket, NewRez...) and agencies stay off the main list. Their
loans belong to Fannie, Freddie, Ginnie or bondholders, so nobody there can sell you
the note. Funds already buying notes (RCF, MCLP, VRMTG...) get their own tab,
**Who's buying**. They're your competition.

A score means **"worth a call"**, not "has notes for sale". No public record says a
bank is selling. You find out from the special assets (loan workout) officer.

---

## Should business loans be in it? Yes, as a separate lane.

They're in, behind the **Business** filter and tab, for three reasons:

- **The data is already there.** The same call report splits out commercial &
  industrial loans, so it costs nothing extra.
- **They're a big share of what community banks sell.** Commercial real estate and
  business loans are most of the non-performing book at many small banks, and those
  notes are sold one at a time.
- **SBA's loan-level file is public.** It shows the borrower, lender, amount and
  charge-off date for every SBA-guaranteed loan.

They need a different kind of diligence than house notes, which is why they're kept
apart:

- **Collateral.** Business-loan collateral is equipment, receivables and a personal
  guarantee, not a house. Valuing it is harder, and recovery often depends on
  chasing the guarantor.
- **Stick to real estate-backed business loans.** Owner-occupied commercial real
  estate and loans backed by real estate liens are the easiest place to start.
  Unsecured business notes trade at pennies for a reason.
- **SBA loans come in pieces.** On a charged-off SBA 7(a) loan the SBA has usually
  bought back the guaranteed share. The bank still holds the unguaranteed 25–50% and
  shares the collateral with the SBA. That piece can be bought, but only through the
  bank's workout officer, with SBA consent on the collateral.
- **Different rules.** Business notes aren't consumer mortgages, so residential
  servicing licensing and 940 CMR 25.00 don't apply. Commercial collection law
  still does.

---

## Setup — about 30 minutes

### 1. Give it its own repository

For now NoteLine is a folder inside `nomatterwhat`. It works best as its own private
repo, like Deedline, because GitHub only runs workflows from a repo's top-level
`.github` folder.

- **github.com/new** → name `noteline` → **Private** → no README → **Create**.
- Ask Claude to move the `noteline/` folder into it, or upload the folder's
  contents (drag them in, including the `.github` folder).
- **Settings → Actions → General → Workflow permissions → Read and write** → Save.

### 2. Email (same as Deedline)

**Settings → Secrets and variables → Actions**, and add the same three secrets Deedline
uses: `SMTP_USER`, `SMTP_PASSWORD` (the Gmail App Password) and, optionally,
`EMAIL_TO`. You can reuse Deedline's App Password.

### 3. Connect Deedline (for loan-level leads)

NoteLine reads `site/leads.json` from your private Deedline repo.

- **github.com/settings/personal-access-tokens/new**
  - Name `noteline-reads-deedline`, longest expiry
  - Repository access: **Only select repositories → deedline**
  - Permissions: **Contents → Read-only**
  - Generate, copy.
- Add it to the **noteline** repo as a secret named `DEEDLINE_TOKEN`.

Without it, NoteLine still runs on bank data alone, and the email says it isn't
connected.

### 4. Optional: SBA business loans

- Go to **data.sba.gov** and search for **"7(a) & 504 FOIA"**.
- Copy the download link for the **7(a) file covering FY2020 to present** (it's a
  few hundred MB, streamed, never held in memory). The 504 file is optional.
- In `config.json`, set `"enabled": true` under `"sba"` and paste the link(s)
  into `"csv_urls"`.

The SBA renames these files each quarter, so update the link when the numbers look
stale. It's refreshed quarterly.

### 5. Your details for the letters

In `config.json`, fill in `buyer`: your name, company, phone and email. They go into
each call brief's letter. Until you do, the letters show `[Your name]`-style
placeholders.

### 6. Turn on the tracker (the private web app)

This is the same arrangement as Deedline's dashboard: a Google Apps Script web app,
behind your Google sign-in, that serves the dashboard with your tracker built in. It
adds:

- A status, follow-up date and optional Calendar reminder on each lender
- **Contacts**: the special assets and workout people you find. Over time this becomes
  your own version of the contact database the paid tools charge for.
- Timestamped call notes
- A **Your pipeline** tab: every lender you've touched, soonest follow-up first
- **Rewrite with Claude**: redrafts a lender's letter using your contacts and notes
- Pasting Registry search results straight into NoteLine, plus a **Run now** button

Everything you enter is saved in a Google Sheet called **NoteLine tracker**, which
is created in your Drive the first time you use it.

1. **Make a GitHub token.** Go to **github.com/settings/personal-access-tokens/new**.
   - Name: `noteline-tracker`
   - Repository access: only `noteline`
   - Permissions: **Contents → Read and write** and **Actions → Read and write**
2. **Create the project.** Go to **script.google.com → New project**, name it
   `NoteLine`, and paste in `apps-script/webapp.gs`. Save.
3. **Add the token.** **Project Settings → Script Properties**, and add `GITHUB_TOKEN`.
4. **Optional: Claude-written letters.** Add a second Script Property,
   `ANTHROPIC_API_KEY`, with a key from **platform.claude.com**. This uses Claude
   Opus 5; a letter costs a few cents. Without it, the template letter is always
   there.
5. **Deploy it.** **Deploy → New deployment → Web app**. Set **Execute as: Me** and
   **Who has access: Only myself**. Approve the permissions it asks for (Sheets,
   Calendar, and connecting to GitHub and Claude), then bookmark the URL.

When `webapp.gs` changes later, go to **Deploy → Manage deployments → edit →
New version**. The URL stays the same.

### 7. Run it

**Actions → NoteLine weekly → Run workflow**. The email arrives a few minutes later.
After that it runs every Monday morning.

---

## Settings (`config.json`)

| Key | What it does |
|---|---|
| `states` | Which states' banks to score. `[]` scores every bank in the country. |
| `foreclosure_state` | The state Deedline's filings come from. |
| `deedline_source` | `owner/repo` of Deedline, or a local path to a `leads.json`. |
| `foreclosure_window_days` | How far back filings count toward a lender. |
| `lender_overrides` | Fix a lender the name patterns got wrong, e.g. `{"Acme Capital LLC": "private"}`. Kinds: `portfolio`, `private`, `npl_buyer`, `servicer`, `agency`. |
| `sba` | Business-loan file settings, above. |
| `ncua` | `{"enabled": false}` turns off credit unions. |
| `buyer` | Your name, company, phone, email, markets and days to close, used in the letters. |
| `bid` | The bid assumptions: target return, legal costs, months after Land Court, extra months for estates, assessed-to-market factor, and `lookup_values` to switch MassGIS lookups on or off. |

## Running it on your computer

```bash
python run.py --out site                   # live FDIC data
python -m unittest discover tests          # tests, offline
python run.py --out /tmp/demo \
  --fdic-cache tests/fixtures/fdic_sample.json \
  --deedline tests/fixtures/deedline_leads.json \
  --sba tests/fixtures/sba_sample.csv --offline   # fully offline demo
```

The fixture bank figures are made up and exist only for tests.

## Before you buy a note

- **Residential mortgage notes in Massachusetts:** the note has to be serviced by a
  licensed mortgage servicer. Hire one rather than servicing it yourself.
- **Contacting homeowners in foreclosure** is regulated (940 CMR 25.00). Deedline's
  outreach rules apply here too.
- **Buy through an entity**, and have counsel review the first purchases, including
  the assignment chain, allonges, and the original note's endorsements.

## Proven sellers: how the evidence builds

| Evidence | Where it comes from | Strength |
|---|---|---|
| Recorded assignment | Registry searches you paste in, or CSVs in `data/assignments/`. The format is in that folder's README. | Strongest. It's the legal record of the sale. |
| Refiled | The same property foreclosed on first by one lender, then by another. NoteLine's own filing history finds these, and it grows every week. | Strong |
| Caption | A plaintiff calling itself "successor by asset purchase to" or "assignee of" another lender. | Supporting |

Mergers, like "Eastern Bank, successor by merger to HarborOne", are the same lender
under a new name, not a sale. NoteLine excludes them, but still counts the old
name's filings toward the surviving bank.

**Where to start:** the dashboard's **Proven sellers → Find more at the Registry**
list names who to search. Search the busiest note buyers as grantee: every grantor
on their assignments is a bank that sells. Then search your top-scored banks as
grantor. One registry search per name, a few minutes each.

## The bid, and how far to trust it

For each note a lender is foreclosing on, NoteLine estimates:

- **value**: the town assessor's figure from the MassGIS statewide parcel layer
- **timeline**: the median time a Land Court case stays open before the lender can
  go to sale, measured by county from the filings NoteLine and Deedline have seen,
  plus 9 months for notice, sale and resale. Until enough cases have closed, it
  assumes 5 months in Land Court and says so.
- **costs**: resale (8%), repairs (5%), legal ($7,500), and taxes, insurance and
  servicing for every month of the timeline
- **bid** = what's left, discounted at your target return (20%/year by default),
  with a conservative and an aggressive figure on either side

The note's unpaid balance isn't public. Enter it in the calculator once the seller
tells you; the bid never goes above it. Reverse mortgages are skipped: they go to
HUD when they default. Estates add 6 months. A town tax taking on the same address
is flagged, because town taxes are paid before the mortgage.

It's a starting point for the call, not an offer. Check the property, lien position
and title before you bid.

## What's next

- **Other states' foreclosure filings:** Deedline covers Massachusetts Land Court only.
- **Automated Registry searches:** assignment records are pasted in by hand for now.
  A bulk vendor feed (ATTOM or similar) drops into `data/assignments/` in the same
  format when the volume justifies paying for one.
