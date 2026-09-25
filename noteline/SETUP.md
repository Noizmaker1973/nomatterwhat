# NoteLine — find lenders likely to sell non-performing notes

Deedline finds properties. NoteLine finds **lenders**: the banks, credit unions and
private lenders carrying non-performing loans who have a reason to sell them, with
the loan types and, where Deedline has them, the addresses.

Every Monday morning it:

1. Pulls the latest **FDIC call reports** for every bank in your states (MA, NH, RI,
   CT, ME and VT by default). Every insured bank reports each quarter how much of its
   book is 90+ days late or on nonaccrual, split by home loans, commercial real estate
   and business loans.
2. Reads **Deedline's Land Court filings** and groups them by plaintiff. A bank or
   private lender foreclosing in its own name holds that exact bad note right now.
3. Optionally reads the **SBA 7(a)/504 loan file** for business-loan charge-offs.
4. Scores each lender on how likely it is to sell, and emails you the list with an
   interactive dashboard attached. Same as Deedline.

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

## Setup — about 15 minutes

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

### 5. Run it

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

## Running it on your computer

```bash
python run.py --out site                   # live FDIC data
python -m unittest discover tests          # tests, offline
python run.py --out /tmp/demo \
  --fdic-cache tests/fixtures/fdic_sample.json \
  --deedline tests/fixtures/deedline_leads.json \
  --sba tests/fixtures/sba_sample.csv       # fully offline demo
```

The fixture bank figures are made up and exist only for tests.

## Before you buy a note

- **Residential mortgage notes in Massachusetts:** the note has to be serviced by a
  licensed mortgage servicer. Hire one rather than servicing it yourself.
- **Contacting homeowners in foreclosure** is regulated (940 CMR 25.00). Deedline's
  outreach rules apply here too.
- **Buy through an entity**, and have counsel review the first purchases, including
  the assignment chain, allonges, and the original note's endorsements.

## What's next

- **Credit unions:** the NCUA publishes the same kind of quarterly call report data
  (5300). It's the obvious next source. Right now credit unions show up only when
  they're foreclosing.
- **Other states' foreclosure filings:** Deedline covers Massachusetts Land Court only.
- **Tracker:** a notes/status/follow-up sheet per lender, like Deedline's Apps
  Script web app.
