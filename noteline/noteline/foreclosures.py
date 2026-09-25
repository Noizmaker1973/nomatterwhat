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
from datetime import date
from pathlib import Path

from .http import get
from .lenders import buyer_name, classify, clean_name, norm

DEEDLINE_API = "https://api.github.com/repos/{repo}/contents/site/leads.json"


def load_deedline(source: str | None) -> dict | None:
    """
    Read Deedline's leads.json from a local path, or from its private GitHub
    repo when DEEDLINE_TOKEN is set. Returns None when neither is available,
    so NoteLine still runs on bank data alone.
    """
    if source and Path(source).exists():
        return json.loads(Path(source).read_text())
    token = os.environ.get("DEEDLINE_TOKEN")
    repo = os.environ.get("DEEDLINE_REPO") or source
    if token and repo and "/" in repo and not Path(repo).suffix:
        raw = get(DEEDLINE_API.format(repo=repo),
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
    for lead in (deedline or {}).get("leads", []):
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
