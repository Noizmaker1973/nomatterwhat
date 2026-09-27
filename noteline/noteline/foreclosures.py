"""
Loan-level leads, borrowed from Deedline.

Every Massachusetts foreclosure starts with a Servicemembers case in Land Court,
and the plaintiff on that case is whoever holds or services the note. Deedline
already parses those filings every weekday. NoteLine reads Deedline's
leads.json, keeps a running history (Deedline's view is a rolling window), and
groups the filings by lender.

A community bank or credit union with a handful of active foreclosures is a
lender with specific non-performing notes on its books right now — you can call
and name the addresses.
"""

from __future__ import annotations

import json
import os
import re
from datetime import date
from pathlib import Path

from .http import get
from .lenders import buyer_name, classify, clean_name, norm

DEEDLINE_API = "https://api.github.com/repos/{repo}/contents/site/{file}"


def load_deedline(source: str | None, file: str = "leads.json") -> dict | None:
    """
    Read one of Deedline's site/ files (leads.json, history.json) from a local
    path, or from its private GitHub repo when DEEDLINE_TOKEN is set. Returns
    None when neither is available, so NoteLine still runs on bank data alone.
    A local path may name the file itself or the folder holding it.
    """
    if source and Path(source).exists():
        p = Path(source)
        if p.is_dir():
            p = p / file
        elif file != "leads.json":
            p = p.with_name(file)   # a leads.json path: its sibling
        return json.loads(p.read_text()) if p.exists() else None
    token = os.environ.get("DEEDLINE_TOKEN")
    repo = os.environ.get("DEEDLINE_REPO") or source
    if token and repo and "/" in repo and not Path(repo).suffix:
        raw = get(DEEDLINE_API.format(repo=repo, file=file),
                  headers={"Authorization": f"Bearer {token}",
                           "Accept": "application/vnd.github.raw+json"})
        return json.loads(raw)
    return None


def merge_history(history: dict, deedline: dict | None, today: str | None = None) -> dict:
    """
    Fold today's Servicemembers filings into the running history, keyed by
    case number. Filings that drop off Deedline's window stay in the history;
    last_seen tells you how recently the court still listed them.
    """
    today = today or date.today().isoformat()
    cases = history.setdefault("cases", {})
    takings = history.setdefault("tax_takings", {})
    for lead in (deedline or {}).get("leads", []):
        if lead.get("report") == "taxlien" and lead.get("street"):
            takings[addr_key(lead["street"], lead.get("city", ""))] = {
                "case_number": lead.get("case_number"), "town": lead.get("plaintiff", ""),
                "filed_date": lead.get("filed_date"), "last_seen": today}
        if lead.get("report") != "servicemembers" or not lead.get("case_number"):
            continue
        lender = lead.get("plaintiff") or lead.get("mover") or ""
        prev = cases.get(lead["case_number"], {})
        cases[lead["case_number"]] = {
            "case_number": lead["case_number"],
            "filed_date": lead.get("filed_date") or prev.get("filed_date"),
            "lender": lender,
            "street": lead.get("street", ""),
            "city": lead.get("city", ""),
            "county": lead.get("county", ""),
            "owner": lead.get("owner") or lead.get("defendant", ""),
            "is_estate": bool(lead.get("is_estate")),
            "is_reverse_mortgage": bool(lead.get("is_reverse_mortgage")),
            "first_seen": prev.get("first_seen") or lead.get("first_seen") or today,
            "last_seen": today,
        }
    history["updated"] = today
    return history


def addr_key(street: str, city: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", (street or "").lower())
    s = re.sub(r"\b(street|st|road|rd|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|"
               r"terrace|ter|circle|cir|way|boulevard|blvd|unit|apt)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    c = re.sub(r"[^a-z]", "", (city or "").lower())
    return f"{s}|{c}" if s and c else ""


def by_lender(history: dict, window_days: int = 365, today: date | None = None,
              overrides: dict[str, str] | None = None) -> dict[str, dict]:
    """
    Group filings from the last `window_days` by lender. Keyed by the
    normalised lender name so "Eastern Bank" and "Eastern Bank, a
    Massachusetts corporation" count together. `overrides` maps a lender name
    to a kind, for when the name patterns guess wrong.
    """
    today = today or date.today()
    fixed = {norm(k): v for k, v in (overrides or {}).items()}
    groups: dict[str, dict] = {}
    for c in history.get("cases", {}).values():
        filed = c.get("filed_date") or c.get("first_seen")
        try:
            age = (today - date.fromisoformat(filed[:10])).days
        except (TypeError, ValueError):
            age = None
        if age is not None and age > window_days:
            continue
        kind = fixed.get(norm(c["lender"])) or classify(c["lender"])
        name = buyer_name(c["lender"]) if kind == "npl_buyer" else clean_name(c["lender"])
        key = norm(name)
        if not key:
            continue
        g = groups.setdefault(key, {"name": name, "kind": kind,
                                    "filings": [], "last_90": 0, "last_30": 0})
        g["filings"].append({**c, "age_days": age})
        if age is not None and age <= 90:
            g["last_90"] += 1
        if age is not None and age <= 30:
            g["last_30"] += 1
    for g in groups.values():
        g["filings"].sort(key=lambda f: f.get("filed_date") or "", reverse=True)
        g["count"] = len(g["filings"])
    return groups
