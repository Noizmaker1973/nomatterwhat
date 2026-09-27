"""NoteLine against fixture data and a fake FDIC API. python -m unittest discover tests"""

import io
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FX = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(ROOT))

import notify  # noqa: E402
import run  # noqa: E402
from noteline import bid, brief, foreclosures, ncua, sba, sellers  # noqa: E402
from noteline.fdic import FDIC, bank_metrics, quarter_metrics  # noqa: E402
from noteline.http import FetchError  # noqa: E402
from noteline.lenders import BankIndex, buyer_name, classify, clean_name  # noqa: E402

TODAY = date(2026, 9, 25)


class Classify(unittest.TestCase):
    def test_kinds(self):
        cases = {
            "Needham Bank": "portfolio",
            "Jeanne D'Arc Credit Union": "portfolio",
            "PeoplesBank": "portfolio",
            "The Cape Cod Five Cents Savings Bank": "portfolio",
            "PennyMac Loan Services, LLC": "servicer",
            "NewRez LLC d/b/a Shellpoint Mortgage Servicing": "servicer",
            "Metropolitan Life Insurance Company": "servicer",
            "Massachusetts Housing Finance Agency": "agency",
            "U.S. Bank Trust National Association, not in its individual capacity but "
            "solely as owner trustee for RCF 2 Acquisition Trust": "npl_buyer",
            "MTGLQ Investors L.P": "npl_buyer",
            "CSMC 2022-RPL4 Trust": "npl_buyer",
            "Deutsche Bank National Trust Company, as Trustee for Option One Mortgage Loan "
            "Trust 2005-5, Asset-Backed Certificates, Series 2005-5": "servicer",
            "J.P. Morgan Mortgage Acquisition Trust 2007-CH4": "servicer",
            "Robert Smith": "private",
            "Nexus Nova LLC": "private",
        }
        for name, kind in cases.items():
            self.assertEqual(classify(name), kind, name)

    def test_names(self):
        self.assertEqual(clean_name("Citizens Bank, N.A. f/k/a RBS Citizens, N.A."), "Citizens Bank, N.A")
        self.assertEqual(buyer_name("U.S. Bank Trust National Association, not in its individual "
                                    "capacity but solely as owner trustee for RCF 2 Acquisition Trust"),
                         "RCF 2 Acquisition Trust")

    def test_bank_index(self):
        idx = BankIndex([{"CERT": 1, "NAME": "Citizens Bank, National Association", "STALP": "RI", "ASSET": 9},
                         {"CERT": 2, "NAME": "Rockland Trust Company", "STALP": "MA", "ASSET": 5},
                         {"CERT": 3, "NAME": "First National Bank", "STALP": "TX", "ASSET": 1},
                         {"CERT": 4, "NAME": "First National Bank", "STALP": "MA", "ASSET": 1}])
        self.assertEqual(idx.match("Citizens Bank, N.A. f/k/a RBS Citizens, N.A.")["CERT"], 1)
        self.assertEqual(idx.match("Rockland Trust")["CERT"], 2)
        self.assertEqual(idx.match("First National Bank", "MA")["CERT"], 4)
        self.assertIsNone(idx.match("Nowhere Savings"))


class FdicMetrics(unittest.TestCase):
    def test_quarter(self):
        m = quarter_metrics({"REPDTE": "20260630", "LNLSGR": 1000, "NCLNLS": 40, "EQ": 90,
                             "LNATRES": 10, "ORE": 10, "LNCI": 200, "P9CI": 2, "NACI": 8})
        self.assertEqual(m["nc_ratio"], 4.0)
        self.assertEqual(m["texas_ratio"], 50.0)
        self.assertEqual(m["segments"]["business"]["nc_ratio"], 5.0)

    def test_noncurrent_falls_back_to_parts(self):
        self.assertEqual(quarter_metrics({"LNLSGR": 100, "NALNLS": 1, "P9LNLS": 1})["nc_ratio"], 2.0)

    def test_year_over_year(self):
        rows = json.loads((FX / "fdic_sample.json").read_text())["financials"]
        m = bank_metrics(rows)[90005]
        self.assertEqual(m["latest"]["repdte"], "20260630")
        self.assertEqual(m["prior"]["repdte"], "20250630")
        self.assertGreater(m["latest"]["nc_ratio"], m["prior"]["nc_ratio"])
        self.assertEqual(len(m["latest"]["history"]), 5)


class FakeApi:
    """Serves institutions/financials; rejects one field name the way the API does."""

    def __init__(self, bad_field=None):
        self.bad, self.calls = bad_field, []
        data = json.loads((FX / "fdic_sample.json").read_text())
        self.inst, self.fin = data["institutions"], data["financials"]

    def __call__(self, url, params=None, headers=None):
        self.calls.append((url, params))
        if self.bad and self.bad in params.get("fields", "").split(","):
            raise FetchError(url, 400, "unknown field")
        rows = self.inst if url.endswith("institutions") else self.fin
        start = params.get("offset", 0)
        page = rows[start:start + params["limit"]]
        return {"meta": {"total": len(rows)}, "data": [{"data": r} for r in page]}


class FdicClient(unittest.TestCase):
    def test_pages_and_prunes(self):
        api = FakeApi(bad_field="P9RECONS")
        c = FDIC(base="https://x", getter=api)
        self.assertEqual(len(c.institutions()), 6)
        rows = c.financials([90001, 90002])
        self.assertNotIn("P9RECONS", c.fields)
        self.assertIn("NCLNLS", c.fields)
        self.assertTrue(rows)

    def test_hops_to_backup_host(self):
        def getter(url, params=None, headers=None):
            if "api.fdic.gov" in url:
                raise FetchError(url, None, "down")
            return {"meta": {"total": 0}, "data": []}
        c = FDIC(getter=getter)
        c.institutions()
        self.assertIn("banks.data.fdic.gov", c.base)


class Foreclosures(unittest.TestCase):
    def test_history_and_grouping(self):
        dl = json.loads((FX / "deedline_leads.json").read_text())
        h = foreclosures.merge_history({}, dl, today="2026-09-25")
        self.assertEqual(len(h["cases"]), 7)  # tax lien row ignored
        # A later run where one filing has dropped off Deedline's window keeps it.
        dl2 = {"leads": dl["leads"][:2]}
        h = foreclosures.merge_history(h, dl2, today="2026-10-02")
        self.assertEqual(len(h["cases"]), 7)
        self.assertEqual(h["cases"]["26 SM 000101"]["last_seen"], "2026-10-02")
        self.assertEqual(h["cases"]["26 SM 000103"]["last_seen"], "2026-09-25")

        g = foreclosures.by_lender(h, today=TODAY)
        self.assertEqual(g["needham bank"]["count"], 2)
        self.assertEqual(g["needham bank"]["last_30"], 1)
        self.assertEqual(g["rcf 2 acquisition trust"]["kind"], "npl_buyer")
        g = foreclosures.by_lender(h, today=TODAY, overrides={"Robert Smith": "servicer"})
        self.assertEqual(g["robert smith"]["kind"], "servicer")

    def test_no_source(self):
        self.assertIsNone(foreclosures.load_deedline(None))


class Sba(unittest.TestCase):
    def test_scan(self):
        out = sba.scan([str(FX / "sba_sample.csv")], {"MA", "NH"}, today=TODAY)
        n = out["lenders"]["Needham Bank"]
        self.assertEqual((n["loans"], n["chargeoffs"], n["recent_chargeoffs"]), (5, 4, 3))
        self.assertEqual(n["recent_chargeoff_amt"], 600000)
        self.assertEqual([r["borrower"] for r in out["recent"]],
                         ["Acme Machine LLC", "Harbor Diner Inc", "Granite Auto"])


def ncua_zip(cycle: str, rows: list[dict], rename_delinquent: bool = False) -> bytes:
    """A miniature NCUA quarterly ZIP: FOICU, two FS220 tables and AcctDesc."""
    dq = "ACCT_041Z" if rename_delinquent else "ACCT_041B"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("FOICU.txt", "CU_NUMBER,CYCLE_DATE,CU_NAME,CITY,STATE\n" + "".join(
            f'{r["n"]},"{cycle}","{r["name"]}","{r["city"]}","{r["state"]}"\n' for r in rows))
        z.writestr("FS220.txt", f"CU_NUMBER,CYCLE_DATE,ACCT_010,ACCT_025B,{dq},ACCT_550,ACCT_551,ACCT_719\n"
                   + "".join(f'{r["n"]},"{cycle}",{r["assets"]},{r["loans"]},{r["dq"]},{r["co"]},0,{r["alw"]}\n'
                             for r in rows))
        z.writestr("FS220A.txt", "CU_NUMBER,CYCLE_DATE,ACCT_997,ACCT_661A,ACCT_798A\n" + "".join(
            f'{r["n"]},"{cycle}",{r["nw"]},{r["ni"]},{r["oreo"]}\n' for r in rows))
        z.writestr("AcctDesc.txt", '"Account","AcctName","TableName"\n'
                   f'"{dq.title().replace("Acct", "Acct")}","Total Amount of Delinquent Loans & Leases (Two or more months)","FS220"\n'
                   '"Acct_010","Total Assets","FS220"\n')
    return buf.getvalue()


CU_NOW = [dict(n=101, name="JEANNE D'ARC CREDIT UNION", city="LOWELL", state="MA", assets=2_000_000_000,
               loans=1_500_000_000, dq=36_000_000, co=4_000_000, alw=15_000_000, nw=180_000_000,
               ni=6_000_000, oreo=2_000_000),
          dict(n=102, name="FARAWAY FCU", city="AUSTIN", state="TX", assets=1, loans=1, dq=0, co=0,
               alw=0, nw=1, ni=0, oreo=0)]
CU_THEN = [dict(CU_NOW[0], dq=12_000_000)]


def write_ncua_cache(folder: Path) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "ncua-2026-06.zip").write_bytes(ncua_zip("6/30/2026", CU_NOW))
    (folder / "ncua-2025-06.zip").write_bytes(ncua_zip("6/30/2025", CU_THEN))


def offline(url, *a, **k):
    raise FetchError(url, 404, "offline")


class CreditUnions(unittest.TestCase):
    def test_parse_and_metrics(self):
        cus = ncua.parse(ncua_zip("6/30/2026", CU_NOW), {"MA"})
        self.assertEqual(list(cus), [101])
        m = ncua.metrics(cus[101], ncua.parse(ncua_zip("6/30/2025", CU_THEN), {"MA"})[101])
        self.assertEqual(m["latest"]["nc_ratio"], 2.4)
        self.assertEqual(m["prior"]["nc_ratio"], 0.8)
        self.assertEqual(m["latest"]["assets"], 2_000_000)          # thousands, like the FDIC
        self.assertEqual(m["latest"]["leverage"], 9.0)
        self.assertEqual(m["latest"]["roa"], 0.6)                   # half-year income annualised
        self.assertEqual(m["latest"]["repdte"], "20260630")

    def test_renamed_code_found_by_description(self):
        cus = ncua.parse(ncua_zip("6/30/2026", CU_NOW, rename_delinquent=True), {"MA"})
        self.assertEqual(cus[101]["delinquent"], 36_000_000)

    def test_load_walks_back_to_published_quarter(self):
        with tempfile.TemporaryDirectory() as d:
            write_ncua_cache(Path(d))
            cus, mets, q = ncua.load({"MA"}, Path(d), offline, today=date(2026, 12, 1))
            self.assertEqual(q, "2026-06")   # Sept not published in this cache
            self.assertEqual(mets[101]["prior"]["nc_ratio"], 0.8)


class ProvenSellers(unittest.TestCase):
    PARTY = ("Rec Date\tBook\tPage\tType Desc\tTown\tName\tParty\n"
             "01/15/2026\t4521\t12\tASSIGNMENT MORTGAGE\tDEDHAM\tNEEDHAM BANK\tGrantor\n"
             "01/15/2026\t4521\t12\tASSIGNMENT MORTGAGE\tDEDHAM\tRCF 2 ACQUISITION TRUST\tGrantee\n"
             "02/01/2026\t4530\t99\tMORTGAGE\tDEDHAM\tJOHN DOE\tGrantor\n"
             "03/01/2026\t4600\t1\tASSIGNMENT\tDEDHAM\tMORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC\tGrantor\n"
             "03/01/2026\t4600\t1\tASSIGNMENT\tDEDHAM\tEASTERN BANK\tGrantee\n")
    DOC = ("Recorded Date,Assignor,Assignee,Address,Town\n"
           "2025-11-02,Eastern Bank,MTGLQ Investors L.P.,4 Elm St,Salem\n"
           "2025-12-01,HarborOne Bank,Eastern Bank,9 Oak Rd,Brockton\n")

    def test_layouts(self):
        a = sellers.parse_assignments(self.PARTY)
        self.assertEqual([(r["assignor"], r["assignee"]) for r in a],
                         [("NEEDHAM BANK", "RCF 2 ACQUISITION TRUST"),
                          ("MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC", "EASTERN BANK")])
        self.assertEqual(a[0]["date"], "2026-01-15")
        self.assertEqual(len(sellers.parse_assignments(self.DOC)), 2)
        self.assertEqual(sellers.parse_assignments("nothing,useful\n1,2\n"), [])

    def test_evidence(self):
        alias = sellers.aliases(["Eastern Bank as successor bank by merger with HarborOne Bank"])
        recs = sellers.parse_assignments(self.PARTY) + sellers.parse_assignments(self.DOC)
        ev = sellers.from_assignments(recs, alias)
        # MERS is skipped; HarborOne -> Eastern is a merger, not a sale.
        self.assertEqual(sorted(e["seller"] for e in ev), ["Eastern Bank", "NEEDHAM BANK"])
        s = sellers.summarize(ev, alias, today=TODAY)
        self.assertEqual(s["needham bank"]["buyers"], [("RCF 2 ACQUISITION TRUST", 1)])
        self.assertEqual(s["eastern bank"]["recent"], 1)

    def test_refiled(self):
        h = {"cases": {
            "24 SM 1": {"case_number": "24 SM 1", "lender": "Needham Bank", "street": "4 Elm Street",
                        "city": "Dedham", "filed_date": "2024-03-01"},
            "26 SM 9": {"case_number": "26 SM 9", "lender": "RCF 2 Acquisition Trust",
                        "street": "4 Elm St", "city": "Dedham", "filed_date": "2026-02-01"},
            "25 SM 5": {"case_number": "25 SM 5", "lender": "PennyMac Loan Services, LLC",
                        "street": "1 Main St", "city": "Quincy", "filed_date": "2025-01-01"},
            "26 SM 6": {"case_number": "26 SM 6", "lender": "Lakeview Loan Servicing, LLC",
                        "street": "1 Main St", "city": "Quincy", "filed_date": "2026-01-01"}}}
        ev = sellers.from_refilings(h, {})
        self.assertEqual([(e["seller"], e["buyer"]) for e in ev],
                         [("Needham Bank", "RCF 2 Acquisition Trust")])  # servicers don't count

    def test_captions(self):
        ev = sellers.from_captions(["Acme Capital LLC, as assignee of Needham Bank",
                                    "Eastern Bank, successor by merger to Century Bank"])
        self.assertEqual([(e["seller"], e["buyer"]) for e in ev], [("Needham Bank", "Acme Capital LLC")])


class Bids(unittest.TestCase):
    def test_variants(self):
        self.assertEqual(bid.address_variants("11 James Way"), ["11 JAMES WAY"])
        self.assertEqual(bid.address_variants("4 Elm Street, Unit 2"), ["4 ELM ST", "4 ELM STREET"])
        self.assertEqual(bid.address_variants("Lot 7 Hill Rd"), [])

    def test_timelines_count_only_closed_cases(self):
        h = {"cases": {str(i): {"case_number": str(i), "filed_date": "2026-01-01",
                                "last_seen": "2026-05-01", "county": "Norfolk"} for i in range(6)}}
        h["cases"]["open"] = {"case_number": "open", "filed_date": "2026-09-01",
                              "last_seen": "2026-09-24", "county": "Norfolk"}
        tl = bid.timelines(h, today=TODAY)
        self.assertEqual(tl["Norfolk"]["n"], 6)
        months, basis = bid.months_for("Norfolk", tl, {})
        self.assertAlmostEqual(months, 120 / 30.4 + 9, places=1)
        self.assertIn("Norfolk County", basis)
        self.assertIn("assumed", bid.months_for("Suffolk", tl, {})[1])

    def test_estimate(self):
        tl = {}
        e = bid.estimate({"county": "Norfolk"}, {"value": 500000, "fy": 2026}, tl, {})
        self.assertEqual(e["months"], 14)
        self.assertEqual(e["bid"], bid.price(500000, 14, {})["bid"])
        self.assertTrue(e["bid_low"] < e["bid"] < e["bid_high"] < 500000)
        estate = bid.estimate({"is_estate": True}, {"value": 500000}, tl, {}, tax_taking=True)
        self.assertEqual(estate["months"], 20)
        self.assertTrue(any("tax taking" in f for f in estate["flags"]))
        self.assertTrue(bid.estimate({"is_reverse_mortgage": True}, None, tl, {})["skip"])
        self.assertIsNone(bid.estimate({}, None, tl, {})["value"])

    def test_parcels_cache(self):
        calls = []

        def getter(url, params=None, headers=None):
            calls.append(params["where"])
            return {"features": [{"attributes": {"SITE_ADDR": "4 ELM ST", "CITY": "DEDHAM",
                                                 "TOTAL_VAL": 612300, "FY": 2026}}]}
        with tempfile.TemporaryDirectory() as d:
            p = bid.Parcels(Path(d) / "values.json", getter=getter)
            self.assertEqual(p.value("4 Elm Street", "Dedham")["value"], 612300)
            self.assertIn("'4 ELM ST'", calls[0])
            self.assertIn("LIKE '%DEDHAM%'", calls[0])
            p.save()
            again = bid.Parcels(Path(d) / "values.json", getter=offline)
            self.assertEqual(again.value("4 Elm Street", "Dedham")["value"], 612300)
            self.assertEqual(len(calls), 1)


class Brief(unittest.TestCase):
    def test_letter(self):
        l = {"name": "Needham Bank", "cert": 1, "hot_segments": ["cre"],
             "bank": {"nc_ratio": 3.1, "noncurrent": 99000, "repdte": "20260630"},
             "prior": {"nc_ratio": 1.2},
             "foreclosures": {"count": 2, "last_90": 1,
                              "filings": [{"street": "4 Elm St", "city": "Dedham"}]},
             "sold": {"sales": 1, "buyers": [("RCF 2 Acquisition Trust", 1)], "last_date": "2026-01-15"}}
        b = brief.build(l, {"company": "Acme Notes LLC"}, ["MA"])
        self.assertIn("up from 1.20%", b["points"][0])
        self.assertTrue(any("sold notes before" in p for p in b["points"]))
        self.assertIn("4 Elm St, Dedham", b["letter"])
        self.assertIn("Acme Notes LLC", b["letter"])
        self.assertIn("[Your name]", b["letter"])
        self.assertIn("small commercial", b["ask"])


class EndToEnd(unittest.TestCase):
    def run_once(self, out):
        return run.main(["--out", str(out), "--fdic-cache", str(FX / "fdic_sample.json"),
                         "--deedline", str(FX / "deedline_leads.json"),
                         "--sba", str(FX / "sba_sample.csv"),
                         "--assignments", str(out / "assignments"),
                         "--ncua-cache", str(out / "ncua"), "--offline"])

    def prepare(self, out):
        write_ncua_cache(out / "ncua")
        (out / "assignments").mkdir()
        (out / "assignments" / "search.tsv").write_text(ProvenSellers.PARTY)
        # A cached assessor value, as a previous online run would have left it.
        (out / "values.json").write_text(json.dumps({"4 ELM ST|DEDHAM": {
            "parcel": {"value": 600000, "fy": 2026}, "checked": "2099-01-01T00:00:00"}}))

    def test_pipeline(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            self.prepare(out)
            self.assertEqual(self.run_once(out), 0)
            p = json.loads((out / "lenders.json").read_text())
            by = {l["name"]: l for l in p["lenders"]}

            # The stressed small banks lead — the one with a sale on record first —
            # and the money-center bank does not.
            self.assertEqual([l["name"] for l in p["lenders"][:2]],
                             ["Needham Bank", "Granite Mutual Savings Bank"])
            self.assertEqual(by["Needham Bank"]["tier"], "call")
            self.assertEqual(by["Needham Bank"]["foreclosures"]["count"], 2)
            self.assertEqual(by["Needham Bank"]["sba"]["recent_chargeoffs"], 3)
            self.assertIn("business", by["Needham Bank"]["hot_segments"])
            self.assertEqual(by["Citizens Bank, National Association"]["tier"], "background")
            self.assertLessEqual(by["PennyMac Loan Services, LLC"]["score"], 20)
            self.assertEqual(by["Robert Smith"]["kind"], "private")
            self.assertEqual([b["name"] for b in p["buyers"]], ["RCF 2 Acquisition Trust"])

            # Proven seller from the registry file, scored and briefed.
            n = by["Needham Bank"]
            self.assertEqual(n["sold"]["sales"], 1)
            self.assertTrue(any(w.startswith("proven seller") for w in n["why"]))
            self.assertEqual(p["proven_sellers"][0]["lender_id"], n["id"])
            self.assertIn("Has sold notes before", " ".join(n["brief"]["points"]))
            self.assertEqual(p["search_plan"][0], {
                "role": "Grantee", "name": "RCF 2 Acquisition Trust", "doc_type": "Assignment",
                "why": "note buyer with 1 MA foreclosure filings — every assignor it lists is a seller"})

            # Credit union matched to its NCUA record.
            cu = by["Jeanne D'Arc Credit Union"]
            self.assertEqual(cu["id"], "ncua:101")
            self.assertEqual(cu["bank"]["nc_ratio"], 2.4)
            self.assertEqual(cu["foreclosures"]["count"], 1)
            self.assertNotIn("Faraway Fcu", by)

            # Bid on the filing with a cached value; none where no value is known.
            f = {x["street"]: x for x in n["foreclosures"]["filings"]}
            self.assertEqual(f["4 Elm St"]["bid"]["value"], 600000)
            self.assertGreater(f["4 Elm St"]["bid"]["bid"], 0)
            self.assertIsNone(f["9 Oak Rd"]["bid"]["value"])
            self.assertEqual(f["9 Oak Rd"]["bid"]["months"], 20)  # estate

            html = (out / "dashboard.html").read_text()
            self.assertNotIn("/*__NOTELINE_DATA__*/", html)
            self.assertIn('"Needham Bank"', html)
            self.assertTrue((out / "lenders.csv").read_text().startswith("score,tier,name"))

            # Second run: nothing is new, scores unchanged.
            self.run_once(out)
            p2 = json.loads((out / "lenders.json").read_text())
            self.assertFalse(any(l["is_new"] for l in p2["lenders"]))
            self.assertTrue(all(l["score_change"] == 0 for l in p2["lenders"]))

            msg = notify.build_message(p, out)
            self.assertIn("worth a call", msg["Subject"])
            self.assertEqual(len(list(msg.iter_attachments())), 2)


if __name__ == "__main__":
    unittest.main()
