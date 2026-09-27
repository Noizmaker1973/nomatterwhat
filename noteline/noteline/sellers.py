"""
Proven sellers: lenders with a record of actually selling notes.

A lender whose numbers say it *might* sell is a guess. A lender that sold a
note last year is a fact, and the best call on the list. Three kinds of
evidence, strongest first:

  assignment  A recorded Assignment of Mortgage from the lender to a note
              buyer, from Registry of Deeds records. Drop search results into
              data/assignments/ (CSV, TSV, or a paste from masslandrecords.com
              via the tracker) and they are read every run.

  refiled     The same property foreclosed on first by one lender, later by
              another. Between the two filings the note changed hands.
              Found in NoteLine's own foreclosure history, so it grows with
              every week the system runs.

  caption     A plaintiff describing itself as "successor by asset purchase
              to", "assignee of" or "purchaser of" another lender.

Mergers ("successor by merger", "f/k/a") are the same lender renamed, not a
sale, and are excluded — and taught to the matcher as aliases, so a bank's
filings under its old name still count as the same lender.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date
from pathlib import Path

from .foreclosures import addr_key as _addr_key
from .lenders import buyer_name, classify, clean_name, norm

SELLER_KINDS = ("portfolio", "private")
BUYER_KINDS = ("npl_buyer", "private", "portfolio")

MERGER = re.compile(r"\b(?:s/b/m(?: to)?|successor(?: bank)? by merger (?:to|with)|"
                    r"f/k/a|fka|formerly known as)\s+(.+?)(?=,? (?:s/b/m|successor|f/k/a|fka|"
                    r"formerly|d/b/a|dba)\b|$)", re.I)
PURCHASE = re.compile(r"\b(?:successor by (?:asset )?purchase to|as assignee of|assignee of|"
                      r"purchaser of(?: loans from)?)\s+(?:the\s+)?(.+?)(?=,|\bet al\b|$)", re.I)


# ---------------------------------------------------------------------------
# Name aliases from merger captions
# ---------------------------------------------------------------------------

def aliases(captions: list[str]) -> dict[str, str]:
    """Map each predecessor's normalised name to the surviving lender's."""
    out: dict[str, str] = {}
    for cap in captions:
        survivor = norm(cap)
        if not survivor:
            continue
        for m in MERGER.finditer(cap):
            old = norm(m.group(1))
            if old and old != survivor:
                out[old] = survivor
    return out


def canon(name: str, alias: dict[str, str]) -> str:
    k = norm(name)
    seen = set()
    while k in alias and k not in seen:
        seen.add(k)
        k = alias[k]
    return k


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------

def _kind(name: str, overrides: dict[str, str]) -> str:
    return overrides.get(norm(name)) or classify(name)


def _display(name: str) -> str:
    return buyer_name(name) if classify(name) == "npl_buyer" else clean_name(name)


def from_refilings(history: dict, alias: dict[str, str],
                   overrides: dict[str, str] | None = None) -> list[dict]:
    """Same property, two different lenders over time: the note was sold."""
    overrides = {norm(k): v for k, v in (overrides or {}).items()}
    by_addr: dict[str, list[dict]] = {}
    for c in history.get("cases", {}).values():
        k = _addr_key(c.get("street", ""), c.get("city", ""))
        if k and c.get("lender"):
            by_addr.setdefault(k, []).append(c)
    out = []
    for cases in by_addr.values():
        if len(cases) < 2:
            continue
        cases.sort(key=lambda c: c.get("filed_date") or c.get("first_seen") or "")
        for a, b in zip(cases, cases[1:]):
            ka, kb = canon(a["lender"], alias), canon(b["lender"], alias)
            if ka == kb:
                continue
            if _kind(a["lender"], overrides) not in SELLER_KINDS:
                continue  # a servicer's loan belonged to someone else
            if _kind(b["lender"], overrides) not in BUYER_KINDS:
                continue  # a servicing transfer, not a sale
            out.append({"type": "refiled", "seller": _display(a["lender"]),
                        "buyer": _display(b["lender"]),
                        "date": b.get("filed_date") or b.get("first_seen") or "",
                        "street": b.get("street", ""), "city": b.get("city", ""),
                        "detail": f"{a['case_number']} → {b['case_number']}"})
    return out


def from_captions(captions: list[str]) -> list[dict]:
    out = []
    for cap in set(captions):
        for m in PURCHASE.finditer(cap):
            seller = clean_name(m.group(1))
            buyer = clean_name(re.sub(r",?\s*(as\s+)?$", "", cap[:m.start()]))
            if not norm(seller) or not norm(buyer) or norm(seller) == norm(buyer):
                continue
            if classify(seller) not in SELLER_KINDS:
                continue
            out.append({"type": "caption", "seller": seller, "buyer": buyer,
                            "date": "", "street": "", "city": "", "detail": cap[:200]})
    return out


# ---------------------------------------------------------------------------
# Registry assignment records
# ---------------------------------------------------------------------------

HEAD = {
    "date": ("recorded date", "rec date", "recording date", "date recorded", "record date",
             "file date", "date"),
    "assignor": ("assignor", "grantor", "grantor(s)", "from", "party 1", "party1", "seller"),
    "assignee": ("assignee", "grantee", "grantee(s)", "to", "party 2", "party2", "buyer"),
    "name": ("name", "party name", "names"),
    "role": ("role", "party", "party type", "type of party", "direction", "gr/ge",
             "grantor/grantee"),
    "doctype": ("doc type", "document type", "type desc", "type", "instrument", "kind",
                "description", "doc desc"),
    "book": ("book", "bk"),
    "page": ("page", "pg"),
    "docno": ("document number", "doc number", "doc #", "instrument number", "doc no", "docno"),
    "street": ("street", "address", "property address", "property", "location", "street address"),
    "city": ("town", "city", "municipality"),
}
ASSIGN = re.compile(r"assign", re.I)


def _date(v: str) -> str:
    v = (v or "").strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", v)
    if m:
        mo, d, y = map(int, m.groups())
        y = y + 2000 if y < 100 else y
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            return ""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v)
    return m.group(0) if m else ""


def _rows(text: str) -> list[list[str]]:
    sample = text[:4000]
    delim = "\t" if sample.count("\t") >= sample.count(",") else ","
    return [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]


def _header(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    """Find the header row: the first one naming at least two known columns."""
    for i, row in enumerate(rows[:15]):
        cells = [c.strip().lower().rstrip(":") for c in row]
        col: dict[str, int] = {}
        for key, names in HEAD.items():
            for n in names:
                if n in cells and cells.index(n) not in col.values():
                    col[key] = cells.index(n)
                    break
        if len(col) >= 2 and (("assignor" in col and "assignee" in col) or "name" in col):
            return i, col
    return None


def parse_assignments(text: str, source: str = "") -> list[dict]:
    """
    Read a registry search export. Two layouts are understood:

      one row per document  — assignor and assignee columns
      one row per party     — a name column and a role column (grantor/grantee),
                              grouped into documents by book/page or doc number

    Rows whose document type is present but not an assignment are skipped.
    """
    rows = _rows(text)
    found = _header(rows)
    if not found:
        return []
    h, col = found
    get = lambda r, k: r[col[k]].strip() if k in col and col[k] < len(r) else ""  # noqa: E731
    docs: dict[str, dict] = {}
    out = []
    for n, r in enumerate(rows[h + 1:]):
        t = get(r, "doctype")
        if t and not ASSIGN.search(t):
            continue
        base = {"date": _date(get(r, "date")), "street": get(r, "street"),
                "city": get(r, "city"), "book": get(r, "book"), "page": get(r, "page"),
                "source": source}
        if "assignor" in col:
            if get(r, "assignor") and get(r, "assignee"):
                out.append({**base, "assignor": get(r, "assignor"), "assignee": get(r, "assignee")})
            continue
        key = get(r, "docno") or f"{get(r, 'book')}-{get(r, 'page')}"
        if key == "-":
            key = f"row{n}"
        d = docs.setdefault(key, {**base, "assignor": "", "assignee": ""})
        role = get(r, "role").lower()
        side = ("assignee" if re.search(r"grantee|assignee|\bge\b|\b2\b|\bto\b|reverse", role)
                else "assignor")
        d[side] = d[side] or get(r, "name")
        for k in ("date", "street", "city"):
            d[k] = d[k] or base[k]
    out += [d for d in docs.values() if d["assignor"] and d["assignee"]]
    return out


def load_assignment_dir(folder: Path) -> list[dict]:
    recs: list[dict] = []
    if not folder.exists():
        return recs
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() in (".csv", ".tsv", ".txt"):
            recs += parse_assignments(p.read_text(encoding="utf-8-sig", errors="replace"), p.name)
    return recs


def from_assignments(records: list[dict], alias: dict[str, str],
                     overrides: dict[str, str] | None = None) -> list[dict]:
    """Keep assignments from a lender that could sell to someone who buys."""
    overrides = {norm(k): v for k, v in (overrides or {}).items()}
    out, seen = [], set()
    for r in records:
        a, b = r["assignor"], r["assignee"]
        if canon(a, alias) == canon(b, alias):
            continue
        if _kind(a, overrides) not in SELLER_KINDS or _kind(b, overrides) not in BUYER_KINDS:
            continue
        # MERS assignments move the mortgage between nominees, not the note.
        if re.search(r"mortgage electronic registration|\bMERS\b", a + b, re.I):
            continue
        key = (norm(a), norm(b), r.get("book"), r.get("page"), r.get("date"))
        if key in seen:
            continue
        seen.add(key)
        out.append({"type": "assignment", "seller": clean_name(a), "buyer": _display(b),
                    "date": r.get("date", ""), "street": r.get("street", ""),
                    "city": r.get("city", ""),
                    "detail": (f"Book {r['book']} Page {r['page']}" if r.get("book") else
                               r.get("source", ""))})
    return out


# ---------------------------------------------------------------------------
# Rolling it up
# ---------------------------------------------------------------------------

WEIGHT = {"assignment": 3, "refiled": 2, "caption": 1}


def summarize(evidence: list[dict], alias: dict[str, str],
              today: date | None = None) -> dict[str, dict]:
    """One record per seller: how many sales, to whom, how recently."""
    today = today or date.today()
    out: dict[str, dict] = {}
    for e in evidence:
        k = canon(e["seller"], alias)
        s = out.setdefault(k, {"name": e["seller"], "sales": 0, "strength": 0, "buyers": {},
                               "last_date": "", "recent": 0, "evidence": []})
        s["sales"] += 1
        s["strength"] += WEIGHT[e["type"]]
        s["buyers"][e["buyer"]] = s["buyers"].get(e["buyer"], 0) + 1
        s["evidence"].append(e)
        if e["date"] and e["date"] > s["last_date"]:
            s["last_date"] = e["date"]
        try:
            if e["date"] and (today - date.fromisoformat(e["date"])).days <= 3 * 365:
                s["recent"] += 1
        except ValueError:
            pass
    for s in out.values():
        s["evidence"].sort(key=lambda e: e["date"] or "", reverse=True)
        s["buyers"] = sorted(s["buyers"].items(), key=lambda kv: -kv[1])
        s["types"] = sorted({e["type"] for e in s["evidence"]}, key=lambda t: -WEIGHT[t])
    return out


def search_plan(buyers: list[dict], candidates: list[dict], proven: dict[str, dict],
                limit: int = 15) -> list[dict]:
    """
    What to look up at the Registry next. Buyers as grantee: every grantor on
    their assignments is a seller. Top-scored lenders not yet proven as
    grantor: one search settles whether they sell.
    """
    plan = [{"role": "Grantee", "name": b["name"], "doc_type": "Assignment",
             "why": f"note buyer with {b['count']} MA foreclosure filings — "
                    "every assignor it lists is a seller"}
            for b in buyers[:limit]]
    for c in candidates:
        if len([p for p in plan if p["role"] == "Grantor"]) >= limit:
            break
        if norm(c["name"]) in proven:
            continue
        plan.append({"role": "Grantor", "name": c["name"], "doc_type": "Assignment",
                     "why": f"scores {c['score']} but no sale on record yet"})
    return plan


def build(history: dict, captions: list[str], assignment_records: list[dict],
          overrides: dict[str, str] | None = None) -> dict:
    alias = aliases(captions)
    evidence = (from_assignments(assignment_records, alias, overrides)
                + from_refilings(history, alias, overrides)
                + from_captions(captions))
    return {"alias": alias, "evidence": evidence, "sellers": summarize(evidence, alias)}
