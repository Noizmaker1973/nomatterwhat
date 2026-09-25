"""
Business loans: the SBA 7(a) and 504 loan-level FOIA files.

The SBA publishes every loan it has guaranteed — borrower, lender, amount,
approval date, and current status, including charge-offs with the date and
amount. Grouped by lender it shows which banks are writing off small-business
loans now; the individual rows are specific defaulted business notes in your
states.

Download: data.sba.gov → "7(a) & 504 FOIA". The file names change every
quarter, so the URL (or a local path) is set in config.json under sba.csv_urls.
The recent 7(a) file is a few hundred MB; it is streamed, never held in memory.

A caution the dashboard repeats: on a charged-off 7(a) loan the SBA has usually
bought back the guaranteed portion. What the bank still holds is the
unguaranteed part (typically 25–50%), plus any collateral it shares with the
SBA. Those pieces do trade, but through the bank's workout officer, not a
listing.
"""

from __future__ import annotations

import csv
import io
import urllib.request
from datetime import date, datetime
from pathlib import Path

from .http import UA

# Column names drift a little between file vintages; accept any of these.
COLS = {
    "lender": ("BankName", "Bank Name", "LenderName"),
    "lender_state": ("BankState", "Bank State"),
    "borrower": ("BorrName", "Borrower Name", "BorrowerName"),
    "city": ("BorrCity", "Borrower City"),
    "state": ("BorrState", "ProjectState", "Borrower State"),
    "amount": ("GrossApproval", "Gross Approval"),
    "approved": ("ApprovalDate", "Approval Date"),
    "status": ("LoanStatus", "Loan Status"),
    "chargeoff_date": ("ChargeOffDate", "ChgOffDate", "Charge Off Date"),
    "chargeoff_amt": ("GrossChargeOffAmount", "ChgOffPrinGr", "Gross Charge Off Amount"),
    "naics": ("NaicsDescription", "NAICSDescription", "NaicsCode"),
    "program": ("Program", "Subprogram"),
}


def _money(v: str) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "") or 0)
    except ValueError:
        return 0.0


def _date(v: str) -> date | None:
    v = (v or "").strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def _open(src: str):
    if Path(src).exists():
        return open(src, newline="", encoding="utf-8-sig", errors="replace")
    req = urllib.request.Request(src, headers={"User-Agent": UA})
    return io.TextIOWrapper(urllib.request.urlopen(req, timeout=300),
                            encoding="utf-8-sig", errors="replace", newline="")


def _resolve(header: list[str]) -> dict[str, str | None]:
    lower = {h.strip().lower(): h for h in header}
    return {k: next((lower[c.lower()] for c in cands if c.lower() in lower), None)
            for k, cands in COLS.items()}


def scan(sources: list[str], states: set[str] | None, recent_days: int = 730,
         today: date | None = None) -> dict:
    """
    One pass over each file. Portfolio-level counts are nationwide per lender
    (a lender's whole SBA book is the signal); the loan-level list keeps only
    recent charge-offs to borrowers in `states`.
    """
    today = today or date.today()
    lenders: dict[str, dict] = {}
    recent: list[dict] = []
    for src in sources:
        with _open(src) as fh:
            reader = csv.DictReader(fh)
            col = _resolve(reader.fieldnames or [])
            if not col["lender"] or not col["status"]:
                raise ValueError(f"{src}: no lender/status columns in {reader.fieldnames[:12]}")
            g = lambda row, k: (row.get(col[k]) or "").strip() if col[k] else ""  # noqa: E731
            for row in reader:
                name = g(row, "lender")
                if not name:
                    continue
                L = lenders.setdefault(name, {"name": name, "state": g(row, "lender_state"),
                                              "loans": 0, "volume": 0.0, "chargeoffs": 0,
                                              "recent_chargeoffs": 0, "recent_chargeoff_amt": 0.0,
                                              "active": 0})
                status = g(row, "status").upper()
                amount = _money(g(row, "amount"))
                L["loans"] += 1
                L["volume"] += amount
                if status in ("EXEMPT", "COMMIT", "DISBURSED", "CURRENT"):
                    L["active"] += 1
                if status != "CHGOFF":
                    continue
                L["chargeoffs"] += 1
                co_date = _date(g(row, "chargeoff_date"))
                if not co_date or (today - co_date).days > recent_days:
                    continue
                co_amt = _money(g(row, "chargeoff_amt"))
                L["recent_chargeoffs"] += 1
                L["recent_chargeoff_amt"] += co_amt
                st = g(row, "state").upper()
                if states is None or st in states:
                    recent.append({"lender": name, "borrower": g(row, "borrower"),
                                   "city": g(row, "city"), "state": st, "approved_amt": amount,
                                   "approved": str(_date(g(row, "approved")) or ""),
                                   "chargeoff_date": co_date.isoformat(), "chargeoff_amt": co_amt,
                                   "industry": g(row, "naics"), "program": g(row, "program")})
    for L in lenders.values():
        L["chargeoff_rate"] = round(L["chargeoffs"] / L["loans"] * 100, 2) if L["loans"] else None
    recent.sort(key=lambda r: r["chargeoff_date"], reverse=True)
    return {"lenders": lenders, "recent": recent}
