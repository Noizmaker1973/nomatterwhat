# Listing to Lead Ads

Built for James E. Guilford III, DiBiasio Realty.

This tool takes a rental you already have on **Zillow** or **Facebook Marketplace** and turns it into ready-to-post copy for every other channel that brings in renter leads. Every ad gets a tracking code, so the **Rental Lead Digest** can tell you which ad and which channel produced each lead.

```
 Zillow / Marketplace listing
        │  copy & paste
        ▼
 Listing to Lead Ads ──► fair housing + MA rules check (illegal lines removed automatically)
        │
        ├─► Craigslist          ├─► Instagram / Facebook post
        ├─► Facebook Marketplace├─► Meta Ads (Housing special category)
        ├─► Zillow Rental Mgr   ├─► Google Ads (responsive search ad + keywords)
        ├─► Apartments.com      ├─► Google Business Profile post
        ├─► Nextdoor            └─► Past-prospect email + text
        │
        ▼  every ad carries a ref like DBR-7K3Q-CL and a UTM-tagged link
 Renter replies ──► Rental Lead Digest reads the reply, logs "Ad Ref" ──► morning email
        │
        ▼
 Next listing ──► "Find matching past prospects" ──► Gmail drafts (you review and send)
```

## Two ways to use it

### 1. Standalone page: works right away, nothing to install

Open `standalone/lead-ads.html` in any browser. It runs entirely on your computer: paste a listing, fix any details, copy the ads. Your contact info is remembered in that browser.

The standalone page writes and checks ads. Saving ads to your log, matching past prospects and creating Gmail drafts need the Apps Script version.

### 2. Apps Script web app: the full loop with your lead log and Gmail

Everything lives in the same Apps Script project as your Rental Lead Digest.

| File | What it is |
|---|---|
| `apps-script/RentalLeadDigest.gs` | Your digest, plus ad attribution (new **Ad Ref** column, an "Ad Reply" Gmail search, and an "Ad DBR-…" tag in the morning email) |
| `apps-script/AdEngine.gs` | Listing reader, compliance checker, ad writer, prospect matcher. Pure JavaScript. |
| `apps-script/AdConverter.gs` | Web app, ad log, prospect matching, Gmail drafts, optional Claude polish. **Edit `AD_CONFIG` here.** |
| `apps-script/AdConverterUI.html` | The page |
| `apps-script/appsscript.json` | Manifest: V8 runtime, web app runs as you and only you can open it |

Setup:

1. Open your digest project at script.google.com (or create a new project).
2. Add the files above. Use **+ → Script** for each `.gs` file and **+ → HTML** for `AdConverterUI`. Name each one exactly as listed, without the extension. If you already pasted the digest, replace it with `RentalLeadDigest.gs` from this folder.
3. In `AdConverter.gs`, fill in `AD_CONFIG`: at least `PHONE`, and `LANDING_URL` if you have a listing page or inquiry form.
4. Run `setup()` once if you haven't already. It creates the lead log the matcher reads.
5. **Deploy → New deployment → Web app.** Set *Execute as: Me* and *Who has access: Only myself*, then open the URL and bookmark it.
6. Optional: run `setClaudeKey('sk-ant-…')` once from the editor to turn on **Polish with Claude**, then delete the key from the editor.

If you use [clasp](https://github.com/google/clasp), `clasp push` from `apps-script/` uploads all five files.

## What the compliance check catches

The ads describe the **unit**, never the tenant. Sentences rated *Removed* are dropped from every generated ad. Sentences rated *Review* are shown to you to decide.

| Rated | Examples | Law |
|---|---|---|
| Removed | "No Section 8", "vouchers not accepted", "no programs" | Source of income, M.G.L. c.151B §4(10) |
| Removed | "no kids", "adults only", "perfect for a couple", "lead paint" | Familial status (FHA, c.151B, MA lead law) |
| Removed | "mature tenants", "no ESAs", "able-bodied", "English-speaking", "no veterans", "Christian home" | Age, disability, national origin, military status, religion |
| Review | "must make 3x rent", "must be employed", "perfect for professionals", "max 3 occupants" | Screens out voucher holders and families |
| Review | application fee, pet fee, a security deposit above one month's rent | M.G.L. c.186 §15B |
| MA rule | broker fee language | MA broker-fee reform (Aug 2025) |

The paid-ad notes also cover platform rules: Meta's *Housing* special ad category (no age, gender or ZIP targeting, and a minimum radius) and Google's US housing ads policy.

This check is a safety net, not legal advice. Read every ad before you post it.

## Why the ads are written the way they are

- **Every reply asks for move-in date and bedroom count.** Those are two of the transaction-readiness fields the Lead Digest scores, so ad replies arrive pre-qualified.
- **"All lawful sources of income welcome, including Section 8"** is on by default. You must accept vouchers in MA anyway, and saying so brings in renters with program backing.
- **Refs are stable per unit.** Re-generating ads for the same address, beds and rent keeps the same codes, so old posts and new posts track together.
- **Prospect matching uses only what the prospect asked for** (city, bedrooms, budget) and skips anyone whose stated budget is well under the rent or who needs more bedrooms than the unit has.

## Developing

```bash
cd lead-gen
```

```bash
npm test
```

```bash
npm run build
```

`npm test` runs the Node tests (parsing, compliance, character limits, refs, matching, and loading all `.gs` files together to catch name collisions in the shared Apps Script namespace). `npm run build` regenerates `standalone/lead-ads.html` from the Apps Script sources. Run it after editing `AdEngine.gs` or `AdConverterUI.html`.

To support another listing site, add its page text as a fixture in `test/fixtures/` and adjust the parsers at the top of `AdEngine.gs`.
