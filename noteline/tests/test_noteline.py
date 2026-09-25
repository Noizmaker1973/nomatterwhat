"""NoteLine against fixture data and a fake FDIC API. python -m unittest discover tests"""

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FX = ROOT / "tests" / "fixtures"
sys.path.insert(0, str(ROOT))

import notify  # noqa: E402
import run  # noqa: E402
from noteline import foreclosures, sba  # noqa: E402
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


class EndToEnd(unittest.TestCase):
    def run_once(self, out):
        return run.main(["--out", str(out), "--fdic-cache", str(FX / "fdic_sample.json"),
                         "--deedline", str(FX / "deedline_leads.json"),
                         "--sba", str(FX / "sba_sample.csv")])

    def test_pipeline(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            self.assertEqual(self.run_once(out), 0)
            p = json.loads((out / "lenders.json").read_text())
            by = {l["name"]: l for l in p["lenders"]}

            # The stressed small banks lead; the money-center bank does not.
            self.assertEqual(p["lenders"][0]["name"], "Granite Mutual Savings Bank")
            self.assertEqual(by["Needham Bank"]["tier"], "call")
            self.assertEqual(by["Needham Bank"]["foreclosures"]["count"], 2)
            self.assertEqual(by["Needham Bank"]["sba"]["recent_chargeoffs"], 3)
            self.assertIn("business", by["Needham Bank"]["hot_segments"])
            self.assertEqual(by["Citizens Bank, National Association"]["tier"], "background")
            self.assertLessEqual(by["PennyMac Loan Services, LLC"]["score"], 20)
            self.assertEqual(by["Robert Smith"]["kind"], "private")
            self.assertEqual([b["name"] for b in p["buyers"]], ["RCF 2 Acquisition Trust"])

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
