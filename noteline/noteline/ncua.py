"""
Credit unions: the NCUA 5300 call report, the credit-union twin of the FDIC's.

The NCUA publishes each quarter's filings for every federally insured credit
union as one ZIP at ncua.gov. Inside are FOICU.txt (who and where) and a set of
FS220*.txt tables keyed by CU_NUMBER, where every figure is an account code
(ACCT_010 = total assets). AcctDesc.txt in the same ZIP says what each code
means; if a code below ever moves, it is found again by its description.

Two differences from banks, both labelled on the dashboard:
  - Delinquency is reported at 60+ days, not 90+, so ratios run a bit higher.
  - Figures are in dollars; they are converted to thousands to match the FDIC.

Credit unions report total delinquency but not a clean split by loan type, so
they carry no "home loans / CRE / business" breakdown.
"""

from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import date
from pathlib import Path

from .http import FetchError, get

URL = "https://ncua.gov/files/publications/analysis/call-report-data-{y}-{m:02d}.zip"

# field: (account code, description pattern used if the code is missing)
ACCOUNTS = {
    "assets":      ("ACCT_010", r"^total assets$"),
    "loans":       ("ACCT_025B", r"^total amount of loans (&|and) leases"),
    "delinquent":  ("ACCT_041B", r"^total amount of delinquent loans (&|and) leases"),
    "chargeoffs":  ("ACCT_550", r"^total amount of all loans charged off"),
    "recoveries":  ("ACCT_551", r"^total amount of all year-to-date recoveries"),
    "net_worth":   ("ACCT_997", r"^total net worth"),
    "net_income":  ("ACCT_661A", r"^net income \(loss\)"),
    "oreo":        ("ACCT_798A", r"^foreclosed and repossessed assets"),
    "allowance":   ("ACCT_719", r"allowance for (loan|credit) (&|and )?(lease )?losses"),
}


def quarter_ends(today: date | None = None, back: int = 6) -> list[tuple[int, int]]:
    """Recent quarter ends, newest first, skipping the one not yet published."""
    today = today or date.today()
    y, m = today.year, (today.month - 1) // 3 * 3
    if m == 0:
        y, m = y - 1, 12
    out = []
    for _ in range(back):
        out.append((y, m))
        m -= 3
        if m == 0:
            y, m = y - 1, 12
    return out


def fetch_zip(y: int, m: int, cache: Path | None = None, getter=get) -> bytes | None:
    if cache:
        p = cache / f"ncua-{y}-{m:02d}.zip"
        if p.exists():
            return p.read_bytes()
    try:
        data = getter(URL.format(y=y, m=m))
    except FetchError as e:
        if e.status in (403, 404):
            return None
        raise
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
        (cache / f"ncua-{y}-{m:02d}.zip").write_bytes(data)
    return data


def _table(z: zipfile.ZipFile, name: str) -> list[dict]:
    member = next((n for n in z.namelist() if Path(n).name.lower() == name.lower()), None)
    if not member:
        return []
    text = z.read(member).decode("latin-1")
    rows = list(csv.DictReader(io.StringIO(text)))
    return [{k.strip().upper(): (v or "").strip() for k, v in r.items() if k} for r in rows]


def _codes(z: zipfile.ZipFile, headers: set[str]) -> dict[str, str]:
    """Resolve each field to a column present in the FS220 tables."""
    desc = {}
    for r in _table(z, "AcctDesc.txt"):
        code = (r.get("ACCOUNT") or "").upper()
        desc[code] = (r.get("ACCTNAME") or "").strip().lower()
    out = {}
    for field, (code, pat) in ACCOUNTS.items():
        if code in headers:
            out[field] = code
            continue
        hit = next((c for c, d in desc.items() if re.search(pat, d) and c in headers), None)
        if hit:
            out[field] = hit
    return out


def parse(zip_bytes: bytes, states: set[str] | None) -> dict[int, dict]:
    """Per CU_NUMBER: name, city, state and the raw account values."""
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    info = {}
    for r in _table(z, "FOICU.txt"):
        st = r.get("STATE", "").upper()
        if states and st not in states:
            continue
        try:
            info[int(r["CU_NUMBER"])] = {"name": r.get("CU_NAME", ""), "city": r.get("CITY", ""),
                                         "state": st, "cycle": r.get("CYCLE_DATE", "")}
        except (KeyError, ValueError):
            continue
    values: dict[int, dict] = {n: {} for n in info}
    headers: set[str] = set()
    tables = sorted(n for n in z.namelist() if re.match(r"(?i)^(.*/)?FS220[A-Z]?\.txt$", n))
    for t in tables:
        for r in _table(z, Path(t).name):
            headers.update(r)
            try:
                n = int(r["CU_NUMBER"])
            except (KeyError, ValueError):
                continue
            if n in values:
                values[n].update({k: v for k, v in r.items() if k.startswith("ACCT_")})
    codes = _codes(z, headers)
    out = {}
    for n, meta in info.items():
        raw = values.get(n, {})
        rec = dict(meta)
        for field, code in codes.items():
            try:
                rec[field] = float(raw.get(code) or 0)
            except ValueError:
                rec[field] = None
        out[n] = rec
    return out


def _k(v):
    return round(v / 1000, 1) if v is not None else None


def metrics(cur: dict, prior: dict | None) -> dict:
    """The same shape fdic.quarter_metrics produces, in thousands."""
    def one(r: dict) -> dict:
        loans, dq, nw = r.get("loans"), r.get("delinquent"), r.get("net_worth")
        assets, alw, oreo = r.get("assets"), r.get("allowance") or 0, r.get("oreo") or 0
        cycle = str(r.get("cycle", ""))
        months = 12
        m = re.search(r"(\d{1,2})/\d{1,2}/(\d{4})", cycle) or re.search(r"\d{4}-(\d{2})", cycle)
        if m:
            months = int(m.group(1)) or 12
        roa = (r["net_income"] * 12 / months / assets * 100
               if r.get("net_income") is not None and assets else None)
        return {
            "repdte": _repdte(cycle),
            "assets": _k(assets), "loans": _k(loans), "noncurrent": _k(dq),
            "nc_ratio": round(dq / loans * 100, 2) if loans and dq is not None else None,
            "early_ratio": None, "past_due_30_89": None,
            "chargeoffs_ytd": _k((r.get("chargeoffs") or 0) - (r.get("recoveries") or 0)),
            "oreo": _k(oreo),
            "texas_ratio": (round((dq + oreo) / (nw + alw) * 100, 2)
                            if dq is not None and nw else None),
            "roa": round(roa, 2) if roa is not None else None,
            "leverage": round(nw / assets * 100, 2) if nw is not None and assets else None,
            "segments": {}, "basis": "60+ days delinquent",
        }
    latest = one(cur)
    prev = one(prior) if prior else None
    latest["history"] = ([{"repdte": prev["repdte"], "nc_ratio": prev["nc_ratio"]}] if prev else []) + \
                        [{"repdte": latest["repdte"], "nc_ratio": latest["nc_ratio"]}]
    return {"latest": latest, "prior": prev}


def _repdte(cycle: str) -> str:
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", cycle)
    if m:
        return f"{m.group(3)}{int(m.group(1)):02d}{int(m.group(2)):02d}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", cycle)
    return "".join(m.groups()) if m else ""


def load(states: set[str] | None, cache: Path | None = None, getter=get,
         today: date | None = None) -> tuple[dict[int, dict], dict[int, dict], str]:
    """
    Latest published quarter plus the same quarter a year earlier.
    Returns (credit unions, metrics by CU_NUMBER, quarter label).
    """
    latest = None
    for y, m in quarter_ends(today):
        data = fetch_zip(y, m, cache, getter)
        if data:
            latest = (y, m, data)
            break
    if not latest:
        raise FetchError(URL, None, "no recent NCUA quarter found")
    y, m, data = latest
    cur = parse(data, states)
    prior_zip = fetch_zip(y - 1, m, cache, getter)
    prior = parse(prior_zip, states) if prior_zip else {}
    return cur, {n: metrics(r, prior.get(n)) for n, r in cur.items()}, f"{y}-{m:02d}"
