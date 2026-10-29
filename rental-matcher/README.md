# MA Rental Matcher

A matchmaking tool for Massachusetts rentals. It works in both directions:

- **Applicant → Vacancies**: which available units does this client actually qualify for, and how well does each fit?
- **Vacancy → Applicants**: which of my applicants are qualified for this unit?

Import landlord and vacancy lists and rental applications from any spreadsheet. The tool ranks every pairing and explains the result.

## Quick start

No install or build step is needed.

```bash
cd rental-matcher
npm start          # serves http://localhost:8080
# …or just open index.html in a browser
```

The app opens on sample data (14 fictional MA vacancies, 8 fictional applicants). Your first import replaces it, or click **Start empty**.

To host it as one self-contained page, run `npm run build:artifact` (writes `dist/rental-matcher.html`). In that build, exports open a copy-to-clipboard panel instead of downloading a file, for hosts that block downloads.

All data is stored in your browser's local storage and is never uploaded anywhere. Use **Import / Export → Export backup** to move it between computers.

## Importing your data

Go to **Import / Export**, choose *Vacancies* or *Applicants*, then drop a CSV/TSV/JSON file or paste rows copied from Excel or Google Sheets.

- Columns are **mapped automatically** from common names (`MLS #`, `City`, `Monthly Rent`, `Beds`, `Section 8`, `FICO`, `Budget`, `Move In`…). You can fix any mapping before importing.
- Values are normalized: `$2,450/mo`, `85k`, `Studio`, `Yes/No/X`, `Now`, `9/1/27`, `Sept 1`, `40x` (the annual-income rule, converted to about 3.33× monthly), `Dorchester` (stored as town Boston, neighborhood Dorchester).
- Columns you don't map are kept as *extra info* on the record.
- **Merge** updates rows with matching IDs and adds new ones. **Replace** swaps out the whole list.
- Download blank templates or the sample files from the same page. `data/` holds the sample CSVs.

## How a match is scored

| Layer | What it checks | Result |
|---|---|---|
| **Dealbreakers** | Rent over budget (beyond the tolerance), too few bedrooms, outside preferred towns/regions, available after the move-in window, pets not allowed, missing must-have amenity, household over the occupancy limit | **Not a fit** |
| **Application screening** | Landlord's income multiple, minimum credit, eviction policy, cash due at signing (co-signers count where accepted) | **Qualified**, **Conditional** (borderline, needs co-signer, or data missing) or **Not qualified** |
| **Fit score 0–100** | Budget, location (exact town / same region), timing, size, amenities, lease term, move-in cost | Ranking within each tier |

Weights, over-budget tolerance, move-in flexibility and strict/loose location matching can all be changed under **Matching rules**.

Locations cover 260+ MA municipalities in 12 regions (Boston, Inner Core, North Shore, Merrimack Valley, MetroWest, Metro South, South Shore, South Coast, Central MA, Pioneer Valley, Berkshires, Cape & Islands). They also understand Boston neighborhoods, villages such as Hyannis and Wollaston, and region names like "North Shore" or "Cape Cod".

## Massachusetts rules built in

- **Source of income** (M.G.L. c.151B §4(10)): voucher holders are always matched. A unit marked "no Section 8" is flagged, and the refusal is not enforced. Income requirements are applied to the **tenant's share** of rent after the subsidy.
- **Upfront charges** (M.G.L. c.186 §15B): application fees and security deposits over one month's rent are flagged. The move-in cost totals first month, last month, deposit and any tenant-paid broker fee.
- **Broker fees**: since Aug 1, 2025, the party who hired the broker pays. Tenant-paid fees are flagged for review.
- **Lead Law** (M.G.L. c.111 §199A): a child under 6 never excludes a household from a pre-1978 unit. A flag reminds you that the owner must delead.
- **Assistance animals** are not pets, so no-pet policies never make them a dealbreaker.
- **Protected classes**: no protected characteristics are collected or used.

This is a decision aid, not legal advice. Verify current requirements with the MA Attorney General's Office, MCAD or counsel.

## Pipeline

Add any match to the **Pipeline** to track it: Shortlisted → Sent to client → Showing → Application → Approved → Lease signed / Declined. Each entry has notes. Match status updates live as records change, and every list can be exported to CSV.

## Project layout

```
rental-matcher/
├── index.html, css/styles.css
├── src/
│   ├── ma-geo.js       # MA towns → regions, neighborhoods & villages
│   ├── csv.js          # CSV parse/stringify
│   ├── schema.js       # field definitions, header aliases, value parsers
│   ├── matcher.js      # matching engine (pure, works in Node and the browser)
│   ├── sample-data.js  # generated from data/*.csv (npm run build:samples)
│   └── app.js          # UI
├── data/               # sample vacancy & applicant CSVs
├── scripts/            # static server, sample bundler, single-file build
└── test/               # node:test suites (npm test)
```

## Next steps toward production

- Shared multi-user storage (e.g. Supabase/Firestore) in place of browser storage, with logins for your team.
- Direct feeds from MLS PIN / RETS, property-management exports, or rental-application platforms.
- Commute-time scoring (MBTA/Google Maps) and map view.
- Email or text a client their shortlist directly from the pipeline.
