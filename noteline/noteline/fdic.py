"""
FDIC call report data, via the free BankFind Suite API (no key needed).

Every FDIC-insured bank files a call report each quarter. Among other things it
reports how many of its loans are 90+ days past due or on nonaccrual — the
definition of a non-performing loan — broken down by loan type. That is the
single best public signal of which lenders are sitting on paper they may want
to sell.

Dollar amounts are in thousands, as the FDIC reports them. Ratios are percents.
Call reports publish about 60 days after quarter end, so this data changes four
times a year; weekly runs are plenty.
"""

from __future__ import annotations

from datetime import date, timedelta

from .http import FetchError, get_json

BASES = ("https://api.fdic.gov/banks", "https://banks.data.fdic.gov/api")

INSTITUTION_FIELDS = "CERT,NAME,CITY,STALP,ASSET,WEBADDR"

# Always wanted. NCLNLS = noncurrent loans (90+ days past due + nonaccrual).
CORE = ["CERT", "REPDTE", "ASSET", "LNLSGR", "LNLSNET", "NCLNLS", "NALNLS",
        "P9LNLS", "P3LNLS", "NTLNLS", "EQ", "LNATRES", "ORE", "ROA", "RBC1AAJ"]

# Balance, 90+ past due, and nonaccrual per loan type. "LN" + suffix is the
# balance; "P9" and "NA" + suffix together are the noncurrent amount.
SEGMENTS = {
    "residential":  "RERES",   # 1-4 family mortgages
    "multifamily":  "REMULT",  # 5+ unit residential
    "cre":          "RENRES",  # nonfarm nonresidential (office, retail, industrial)
    "construction": "RECONS",  # construction and land development
    "business":     "CI",      # commercial and industrial (business loans)
}
EXTENDED = [f"{p}{s}" for s in SEGMENTS.values() for p in ("LN", "P9", "NA")]


class FDIC:
    def __init__(self, base: str | None = None, getter=get_json):
        self.base = base
        self.get = getter
        self.fields = CORE + EXTENDED

    def _call(self, endpoint: str, params: dict) -> dict:
        bases = [self.base] if self.base else list(BASES)
        last: Exception | None = None
        for b in bases:
            try:
                out = self.get(f"{b}/{endpoint}", {"format": "json", **params})
                self.base = b
                return out
            except FetchError as e:
                last = e
                if e.status == 400:  # a real answer from a live API; don't hop hosts
                    raise
        raise last  # type: ignore[misc]

    def _all(self, endpoint: str, params: dict, page: int = 10000) -> list[dict]:
        rows, offset = [], 0
        while True:
            out = self._call(endpoint, {**params, "limit": page, "offset": offset})
            batch = [d.get("data", d) for d in out.get("data", [])]
            rows += batch
            total = (out.get("meta") or {}).get("total", len(rows))
            offset += len(batch)
            if not batch or offset >= total:
                return rows

    def institutions(self) -> list[dict]:
        """Every active insured bank, nationwide — about 4,500 rows, one call."""
        return self._all("institutions", {"filters": "ACTIVE:1",
                                          "fields": INSTITUTION_FIELDS})

    def _prune_fields(self, cert: int) -> None:
        """
        The API rejects the whole request if any field name is unknown. Try
        each one alone and keep those it accepts, so one renamed field costs
        that metric rather than the run.
        """
        keep = []
        for f in self.fields:
            try:
                self._call("financials", {"filters": f"CERT:{cert}", "fields": f"CERT,{f}",
                                          "limit": 1})
                keep.append(f)
            except FetchError as e:
                if e.status != 400:
                    raise
                print(f"  FDIC field {f} not accepted — skipping it")
        self.fields = keep

    def financials(self, certs: list[int], quarters: int = 5) -> list[dict]:
        since = (date.today() - timedelta(days=92 * quarters + 70)).strftime("%Y%m%d")
        rows: list[dict] = []
        for i in range(0, len(certs), 60):
            chunk = certs[i:i + 60]
            params = {"filters": f"CERT:({' OR '.join(map(str, chunk))}) AND "
                                 f"REPDTE:[{since} TO 99991231]",
                      "sort_by": "REPDTE", "sort_order": "DESC"}
            try:
                rows += self._all("financials", {**params, "fields": ",".join(self.fields)})
            except FetchError as e:
                if e.status != 400:
                    raise
                self._prune_fields(chunk[0])
                rows += self._all("financials", {**params, "fields": ",".join(self.fields)})
        return rows


# ---------------------------------------------------------------------------
# Turning call report rows into per-bank metrics
# ---------------------------------------------------------------------------

def _n(row: dict, key: str) -> float | None:
    v = row.get(key)
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _pct(num: float | None, den: float | None) -> float | None:
    if num is None or not den:
        return None
    return round(num / den * 100, 2)


def _sum(*vals: float | None) -> float | None:
    got = [v for v in vals if v is not None]
    return sum(got) if got else None


def quarter_metrics(row: dict) -> dict:
    loans = _n(row, "LNLSGR") or _n(row, "LNLSNET")
    nc = _n(row, "NCLNLS")
    if nc is None:
        nc = _sum(_n(row, "NALNLS"), _n(row, "P9LNLS"))
    cushion = _sum(_n(row, "EQ"), _n(row, "LNATRES"))
    m = {
        "repdte": str(row.get("REPDTE", "")),
        "assets": _n(row, "ASSET"),
        "loans": loans,
        "noncurrent": nc,
        "nc_ratio": _pct(nc, loans),
        "past_due_30_89": _n(row, "P3LNLS"),
        "early_ratio": _pct(_n(row, "P3LNLS"), loans),
        "chargeoffs_ytd": _n(row, "NTLNLS"),
        "oreo": _n(row, "ORE"),
        "texas_ratio": _pct(_sum(nc, _n(row, "ORE")), cushion),
        "roa": _n(row, "ROA"),
        "leverage": _n(row, "RBC1AAJ"),
        "segments": {},
    }
    for name, sfx in SEGMENTS.items():
        bal = _n(row, f"LN{sfx}")
        seg_nc = _sum(_n(row, f"P9{sfx}"), _n(row, f"NA{sfx}"))
        if bal is None and seg_nc is None:
            continue
        m["segments"][name] = {"balance": bal, "noncurrent": seg_nc,
                               "nc_ratio": _pct(seg_nc, bal)}
    return m


def bank_metrics(rows: list[dict]) -> dict[int, dict]:
    """
    Group call report rows by bank. Returns, per CERT, the latest quarter's
    metrics plus the same metrics a year earlier (or the oldest available) so
    the score can tell rising trouble from long-standing trouble.
    """
    by_cert: dict[int, list[dict]] = {}
    for r in rows:
        try:
            by_cert.setdefault(int(r["CERT"]), []).append(r)
        except (KeyError, TypeError, ValueError):
            continue
    out = {}
    for cert, rs in by_cert.items():
        rs.sort(key=lambda r: str(r.get("REPDTE", "")), reverse=True)
        latest = quarter_metrics(rs[0])
        prior = quarter_metrics(rs[min(4, len(rs) - 1)]) if len(rs) > 1 else None
        latest["history"] = [{"repdte": str(r.get("REPDTE", "")),
                              "nc_ratio": quarter_metrics(r)["nc_ratio"]} for r in reversed(rs)]
        out[cert] = {"latest": latest, "prior": prior}
    return out
