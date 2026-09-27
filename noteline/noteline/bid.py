"""
What to bid on a non-performing note.

A non-performing note is worth what the property will net when the loan is
resolved, discounted for how long that takes. Unpaid balance matters only as a
ceiling — you never pay more than the borrower owes — and it isn't public, so
the dashboard asks for it when you have it from the seller.

    net     = value - resale & repair costs - legal - holding costs over the timeline
    bid     = net / (1 + target return) ^ (months / 12)

Three inputs are local, and NoteLine knows them better than a national tool:

  value     the town assessor's figure, from the MassGIS statewide parcel layer
  months    how long Massachusetts foreclosures actually take, measured from the
            Land Court filings NoteLine and Deedline have watched — by county
            once there is enough data, statewide until then
  risks     estates (probate adds months), reverse mortgages (HUD's, not for
            sale), and town tax takings on the same address (senior to the mortgage)
"""

from __future__ import annotations

import json
import re
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path

from .http import FetchError, get_json

PARCEL_LAYERS = (
    "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/"
    "L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer/0/query",
    "https://gisprpxy.itd.state.ma.us/arcgisserver/rest/services/AGOL/"
    "L3Parcels_feature_service/FeatureServer/0/query",
)
FIELDS = "SITE_ADDR,CITY,TOTAL_VAL,FY,USE_CODE,LS_PRICE,LS_DATE,RES_AREA,UNITS"

DEFAULTS = {
    "target_annual_return": 0.20,
    "assessed_to_market": 1.0,
    "legal_costs": 7500,
    "servicing_monthly": 95,
    "tax_insurance_pct_per_year": 0.016,
    "resale_cost_pct": 0.08,
    "repair_reserve_pct": 0.05,
    "servicemembers_months_default": 5,
    "months_after_servicemembers": 9,
    "estate_extra_months": 6,
    "min_county_samples": 5,
    "min_state_samples": 10,
}

SUFFIX = {"STREET": "ST", "ROAD": "RD", "AVENUE": "AVE", "DRIVE": "DR", "LANE": "LN",
          "COURT": "CT", "PLACE": "PL", "TERRACE": "TER", "CIRCLE": "CIR", "BOULEVARD": "BLVD",
          "PARKWAY": "PKWY", "HIGHWAY": "HWY", "SQUARE": "SQ", "WAY": "WAY"}


# ---------------------------------------------------------------------------
# Property values
# ---------------------------------------------------------------------------

def address_variants(street: str) -> list[str]:
    s = re.sub(r"[.,#]", " ", (street or "").upper())
    s = re.sub(r"\s+(UNIT|APT)\s+\S+$", "", re.sub(r"\s+", " ", s)).strip()
    if not re.match(r"^\d", s):
        return []
    words = s.split()
    out = {s}
    last = words[-1]
    for long, short in SUFFIX.items():
        if last == long:
            out.add(" ".join(words[:-1] + [short]))
        elif last == short:
            out.add(" ".join(words[:-1] + [long]))
    return sorted(out)


def _sql(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


class Parcels:
    """Assessor values by address, cached in site/values.json between runs."""

    def __init__(self, cache_path: Path | None, getter=get_json, max_age_days: int = 180,
                 max_lookups: int = 300):
        self.path, self.get = cache_path, getter
        self.cache: dict = {}
        if cache_path and cache_path.exists():
            try:
                self.cache = json.loads(cache_path.read_text())
            except ValueError:
                self.cache = {}
        self.max_age = timedelta(days=max_age_days)
        self.budget = max_lookups
        self.layer = None
        self.dead = False
        self.status = "not used"
        self.hits = self.misses = 0

    def save(self) -> None:
        if self.path:
            self.path.write_text(json.dumps(self.cache, indent=0, sort_keys=True))

    def _query(self, where: str) -> list[dict]:
        layers = [self.layer] if self.layer else list(PARCEL_LAYERS)
        last = None
        for url in layers:
            try:
                out = self.get(url, {"where": where, "outFields": FIELDS, "returnGeometry": "false",
                                     "resultRecordCount": 20, "f": "json"})
            except FetchError as e:
                last = e
                continue
            if "error" in out:
                last = FetchError(url, 400, json.dumps(out["error"])[:200])
                continue
            self.layer = url
            return [f.get("attributes", {}) for f in out.get("features", [])]
        raise last or FetchError("parcels", None, "no layer answered")

    def value(self, street: str, city: str) -> dict | None:
        key = f"{(street or '').upper().strip()}|{(city or '').upper().strip()}"
        hit = self.cache.get(key)
        if hit:
            try:
                fresh = datetime.fromisoformat(hit["checked"]) > datetime.now() - self.max_age
            except (KeyError, ValueError):
                fresh = False
            if fresh:
                return hit.get("parcel")
        if self.dead or self.budget <= 0:
            return hit.get("parcel") if hit else None
        variants = address_variants(street)
        if not variants or not city:
            return None
        self.budget -= 1
        town = re.sub(r"[^A-Z ]", "", city.upper()).strip()
        addr = f"SITE_ADDR IN ({','.join(map(_sql, variants))})"
        try:
            # Town first: "1 MAIN ST" exists in dozens of towns. Assessors
            # sometimes record a village instead (North Scituate), hence LIKE.
            rows = self._query(f"{addr} AND UPPER(CITY) LIKE {_sql('%' + town + '%')}")
        except FetchError as e:
            self.dead = True
            self.status = f"failed: {e}"
            return hit.get("parcel") if hit else None
        parcel = None
        if rows:
            r = max(rows, key=lambda r: r.get("FY") or 0)
            parcel = {"value": r.get("TOTAL_VAL"), "fy": r.get("FY"), "use": r.get("USE_CODE"),
                      "last_sale": r.get("LS_PRICE"), "last_sale_date": r.get("LS_DATE"),
                      "living_area": r.get("RES_AREA"), "units": r.get("UNITS"),
                      "units_on_lot": len(rows)}
            self.hits += 1
        else:
            self.misses += 1
        self.cache[key] = {"parcel": parcel, "checked": datetime.now().isoformat(timespec="seconds")}
        self.status = f"ok — {self.hits} found, {self.misses} not matched this run"
        return parcel


# ---------------------------------------------------------------------------
# Foreclosure timelines, measured
# ---------------------------------------------------------------------------

def _d(v) -> date | None:
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def timelines(history: dict, deedline_history: dict | None = None,
              today: date | None = None, gone_days: int = 14) -> dict:
    """
    How long a Servicemembers case stays on the Land Court list before the
    lender can go to sale: filed date to the day it dropped off. Only cases
    that have dropped off count — open ones would bias the median short.
    """
    today = today or date.today()
    durations: dict[str, list[int]] = {"_all": []}
    seen = set()

    def add(case, filed, last, county):
        f, l = _d(filed), _d(last)
        if not f or not l or case in seen or (today - l).days < gone_days:
            return
        days = (l - f).days
        if 7 <= days <= 3 * 365:
            seen.add(case)
            durations["_all"].append(days)
            if county:
                durations.setdefault(county, []).append(days)

    for c in history.get("cases", {}).values():
        add(c["case_number"], c.get("filed_date"), c.get("last_seen"), c.get("county"))
    for case, c in ((deedline_history or {}).get("cases") or {}).items():
        if c.get("report") == "servicemembers":
            add(case, c.get("filed"), c.get("last"), None)

    out = {k: {"median_days": statistics.median(v), "n": len(v)} for k, v in durations.items() if v}
    return out


def months_for(county: str | None, tl: dict, cfg: dict) -> tuple[float, str]:
    c = {**DEFAULTS, **(cfg or {})}
    after = c["months_after_servicemembers"]
    if county and tl.get(county, {}).get("n", 0) >= c["min_county_samples"]:
        m = tl[county]["median_days"] / 30.4
        return m + after, f"{county} County median {m:.1f} mo in Land Court (n={tl[county]['n']})"
    if tl.get("_all", {}).get("n", 0) >= c["min_state_samples"]:
        m = tl["_all"]["median_days"] / 30.4
        return m + after, f"statewide median {m:.1f} mo in Land Court (n={tl['_all']['n']})"
    m = c["servicemembers_months_default"]
    return m + after, f"assumed {m} mo in Land Court (not enough measured cases yet)"


# ---------------------------------------------------------------------------
# The bid
# ---------------------------------------------------------------------------

def price(value: float, months: float, cfg: dict, rate: float | None = None) -> dict:
    """The formula the dashboard's calculator repeats — keep the two in step."""
    c = {**DEFAULTS, **(cfg or {})}
    r = c["target_annual_return"] if rate is None else rate
    holding = months * (value * c["tax_insurance_pct_per_year"] / 12 + c["servicing_monthly"])
    costs = value * (c["resale_cost_pct"] + c["repair_reserve_pct"]) + c["legal_costs"] + holding
    net = value - costs
    bid = max(0.0, net / (1 + r) ** (months / 12))
    return {"net": round(net), "costs": round(costs), "bid": round(bid / 500) * 500}


def estimate(filing: dict, parcel: dict | None, tl: dict, cfg: dict,
             tax_taking: bool = False) -> dict:
    c = {**DEFAULTS, **(cfg or {})}
    flags = []
    if filing.get("is_reverse_mortgage"):
        return {"skip": True, "flags": ["Reverse mortgage (HECM): these go to HUD when they "
                                        "default and are rarely sold one at a time."]}
    months, basis = months_for(filing.get("county"), tl, c)
    if filing.get("is_estate"):
        months += c["estate_extra_months"]
        flags.append(f"Estate: +{c['estate_extra_months']} months for probate.")
    if tax_taking:
        flags.append("Town tax taking on this address — taxes owed come ahead of the mortgage. "
                     "Get the redemption figure from the town.")
    if parcel and (parcel.get("units_on_lot") or 1) > 1:
        flags.append("Several assessor records at this address (condo or multi-unit) — "
                     "confirm which unit secures the loan.")
    flags.append("Confirm lien position and the unpaid balance with the seller; "
                 "never bid more than the balance.")
    out = {"skip": False, "months": round(months, 1), "timeline_basis": basis, "flags": flags,
           "assumptions": {k: c[k] for k in ("target_annual_return", "legal_costs",
                                             "servicing_monthly", "tax_insurance_pct_per_year",
                                             "resale_cost_pct", "repair_reserve_pct")}}
    if not parcel or not parcel.get("value"):
        out["value"] = None
        return out
    v = float(parcel["value"]) * c["assessed_to_market"]
    r = c["target_annual_return"]
    base = price(v, months, c, r)
    low = price(v * 0.9, months + 6, c, r + 0.05)
    high = price(v * 1.05, max(3, months - 3), c, max(0.05, r - 0.05))
    out.update({"value": round(v), "value_source": f"assessed FY{parcel.get('fy') or '?'}",
                "bid_low": low["bid"], "bid": base["bid"], "bid_high": high["bid"],
                "bid_pct_of_value": round(base["bid"] / v * 100) if v else None,
                "net": base["net"], "costs": base["costs"]})
    return out
