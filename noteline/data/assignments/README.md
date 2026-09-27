# Registry assignment records

Every `.csv`, `.tsv` or `.txt` file in this folder is read on each run and used
to find **proven sellers**: lenders that have assigned a mortgage to a note
buyer. Files pasted from the dashboard (inside the Google web app) land here
automatically.

## Getting them

1. Go to [masslandrecords.com](https://www.masslandrecords.com/) and pick a registry.
2. **Search Criteria → Recorded Land → Name Search.**
3. Document type: **Assignment** (sometimes listed as "ASSIGNMENT MORTGAGE" or "ASSIGN").
4. Search a name from the dashboard's **Proven sellers → Find more at the Registry**
   list, in the role shown: a note buyer as **grantee** (every grantor it lists is
   a seller), or a bank you're targeting as **grantor**.
5. Copy the results table, including its header row, and paste it into the
   dashboard. Or paste it into a spreadsheet, save it as CSV, and upload it here.

## Formats understood

The header row is found automatically, and the column names can vary. Either:

**One row per document:**

```
Recorded Date,Assignor,Assignee,Address,Town,Book,Page
2025-11-02,Eastern Bank,MTGLQ Investors L.P.,4 Elm St,Salem,1234,56
```

**One row per party** (how most registry name searches list results), grouped
into documents by book and page or document number:

```
Rec Date	Book	Page	Type Desc	Town	Name	Party
01/15/2026	4521	12	ASSIGNMENT MORTGAGE	DEDHAM	NEEDHAM BANK	Grantor
01/15/2026	4521	12	ASSIGNMENT MORTGAGE	DEDHAM	RCF 2 ACQUISITION TRUST	Grantee
```

These rows are ignored:

- rows whose document type is present but isn't an assignment
- assignments involving MERS, which move the nominee rather than the note
- assignments between two names for the same lender (for example, after a merger)

Bulk assignment data from a vendor (ATTOM, for example) works the same way:
export it as CSV with assignor and assignee columns.
