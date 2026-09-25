"""
Scoring: how likely is this lender to sell you a non-performing note?

A lender sells notes when it has bad loans AND a reason to get them off the
books. The call report shows both: the pile (noncurrent loans), the direction
(is the pile growing), and the pressure (thin capital, losses, a high Texas
ratio). Size decides whether it sells to people like you — community banks sell
one-offs and small pools by phone; the giants sell $100M pools at auction.

The score means "worth a call," not "has notes for sale." Nothing public says
that; only the bank's special assets officer does.
"""

from __future__ import annotations

from .lenders import BankIndex

FDIC_PAGE = "https://banks.data.fdic.gov/bankfind-suite/bankfind/details/{cert}"
FOCUS_GROUPS = {"residential": ("residential",),
                "cre": ("cre", "multifamily", "construction"),
                "business": ("business",)}


def _seg_group(segments: dict, names: tuple[str, ...]) -> dict | None:
    bal = sum((segments.get(n) or {}).get("balance") or 0 for n in names)
    nc = sum((segments.get(n) or {}).get("noncurrent") or 0 for n in names)
    if not bal and not nc:
        return None
    return {"balance": bal, "noncurrent": nc, "nc_ratio": round(nc / bal * 100, 2) if bal else None}


def score_bank(m: dict, prior: dict | None, add) -> None:
    ratio = m.get("nc_ratio")
    if ratio is not None:
        if ratio >= 4:      add(25, f"{ratio:.1f}% of loans noncurrent — very high")
        elif ratio >= 2.5:  add(20, f"{ratio:.1f}% of loans noncurrent — high")
        elif ratio >= 1.5:  add(14, f"{ratio:.1f}% of loans noncurrent")
        elif ratio >= 0.75: add(7, f"{ratio:.1f}% of loans noncurrent")
    if ratio is not None and prior and prior.get("nc_ratio") is not None:
        delta = ratio - prior["nc_ratio"]
        if delta >= 1.0:    add(15, f"noncurrent up {delta:.1f} pts in a year")
        elif delta >= 0.4:  add(9, f"noncurrent up {delta:.1f} pts in a year")
        elif delta <= -0.5: add(-5, f"noncurrent down {-delta:.1f} pts — already cleaning up")
    early = m.get("early_ratio")
    if early is not None and early >= 1.5:
        add(6, f"{early:.1f}% of loans 30–89 days late — more coming")
    tx = m.get("texas_ratio")
    if tx is not None:
        if tx >= 50:        add(15, f"Texas ratio {tx:.0f}% — under real pressure")
        elif tx >= 25:      add(8, f"Texas ratio {tx:.0f}%")
    lev = m.get("leverage")
    if lev is not None and lev < 7:
        add(8, f"thin capital (leverage {lev:.1f}%)")
    roa = m.get("roa")
    if roa is not None:
        if roa < 0:         add(8, "losing money this year")
        elif roa < 0.4:     add(3, "weak earnings")
    nc = m.get("noncurrent") or 0
    if nc >= 5000:
        add(4, f"${nc / 1000:,.1f}M in noncurrent loans")
    assets = m.get("assets") or 0
    if 100_000 <= assets <= 10_000_000:
        add(8, "community bank — sells one-offs and small pools")
    elif assets > 100_000_000:
        add(-10, "money-center bank — sells only through large auctions")


def build(institutions: list[dict], metrics: dict[int, dict], fc_groups: dict[str, dict],
          sba: dict | None, cfg: dict) -> dict:
    states = set(cfg.get("states") or [])
    index = BankIndex(institutions)
    by_cert = {int(i["CERT"]): i for i in institutions if i.get("CERT")}
    lenders: dict[str, dict] = {}
    buyers: list[dict] = []

    def rec_for_bank(inst: dict) -> dict:
        cert = int(inst["CERT"])
        rid = f"fdic:{cert}"
        if rid not in lenders:
            lenders[rid] = {"id": rid, "name": inst.get("NAME", ""), "kind": "portfolio",
                            "city": inst.get("CITY", ""), "state": inst.get("STALP", ""),
                            "cert": cert, "web": inst.get("WEBADDR") or "",
                            "fdic_url": FDIC_PAGE.format(cert=cert),
                            "bank": None, "prior": None, "foreclosures": None, "sba": None}
        return lenders[rid]

    # 1. Every bank in the covered states that has call report data.
    for cert, mm in metrics.items():
        inst = by_cert.get(cert)
        if inst and (not states or inst.get("STALP") in states):
            r = rec_for_bank(inst)
            r["bank"], r["prior"] = mm["latest"], mm["prior"]

    # 2. Foreclosing lenders from Deedline.
    fc_state = cfg.get("foreclosure_state", "MA")
    for key, g in fc_groups.items():
        fc = {k: g[k] for k in ("count", "last_30", "last_90", "filings")}
        if g["kind"] == "npl_buyer":
            buyers.append({"name": g["name"], **fc})
            continue
        inst = index.match(g["name"], fc_state) if g["kind"] == "portfolio" else None
        if inst:
            r = rec_for_bank(inst)
            mm = metrics.get(int(inst["CERT"]))
            if mm and r["bank"] is None:
                r["bank"], r["prior"] = mm["latest"], mm["prior"]
        else:
            rid = f"name:{key}"
            r = lenders.setdefault(rid, {"id": rid, "name": g["name"], "kind": g["kind"],
                                         "city": "", "state": fc_state, "cert": None, "web": "",
                                         "fdic_url": "", "bank": None, "prior": None,
                                         "foreclosures": None, "sba": None})
        r["foreclosures"] = fc

    # 3. SBA lenders. Only attach to lenders already on the list or banks in
    #    the covered states — the national SBA roster is thousands of names.
    if sba:
        for name, s in sba["lenders"].items():
            inst = index.match(name, s.get("state") or None)
            if not inst or (states and inst.get("STALP") not in states
                            and f"fdic:{inst['CERT']}" not in lenders):
                continue
            r = rec_for_bank(inst)
            if r["bank"] is None and int(inst["CERT"]) in metrics:
                mm = metrics[int(inst["CERT"])]
                r["bank"], r["prior"] = mm["latest"], mm["prior"]
            r["sba"] = {k: s[k] for k in ("loans", "volume", "active", "chargeoffs",
                                          "chargeoff_rate", "recent_chargeoffs",
                                          "recent_chargeoff_amt")}
            r["sba"]["loans_list"] = [x for x in sba["recent"] if x["lender"] == name][:25]

    # 4. Score.
    out = []
    for r in lenders.values():
        s, why = 0, []

        def add(n, label):
            nonlocal s
            s += n
            why.append(label)

        m = r["bank"]
        if m:
            score_bank(m, r["prior"], add)
            r["assets"] = m.get("assets")
            r["focus"] = {}
            for grp, names in FOCUS_GROUPS.items():
                sg = _seg_group(m.get("segments") or {}, names)
                if sg:
                    r["focus"][grp] = sg
            hot = [g for g, sg in r["focus"].items()
                   if (sg["nc_ratio"] or 0) >= 1.5 and (sg["noncurrent"] or 0) >= 250]
            if hot:
                add(0, "trouble concentrated in " + ", ".join(
                    {"residential": "home loans", "cre": "commercial real estate",
                     "business": "business loans"}[g] for g in hot))
            r["hot_segments"] = hot
        else:
            r["assets"], r["focus"], r["hot_segments"] = None, {}, []

        fc = r["foreclosures"]
        if fc:
            n = fc["count"]
            if r["kind"] in ("portfolio", "private"):
                add(min(24, 8 * n), f"{n} MA foreclosure filing{'s' if n != 1 else ''} as plaintiff")
                if fc["last_30"]:
                    add(6, f"{fc['last_30']} filed in the last 30 days")
                if r["kind"] == "private":
                    add(22, "private lender — often the most willing note seller")
                elif not r["cert"] and "credit union" in r["name"].lower():
                    add(14, "credit union — holds its loans in portfolio")
                if r["kind"] == "portfolio":
                    why.append("may be servicing some of these for Fannie/Freddie — ask")
                if "residential" not in r["hot_segments"]:
                    r["hot_segments"].append("residential")
            else:
                why.append(f"{n} MA filings, but as servicer/agency — "
                           "the loans belong to investors")

        sb = r["sba"]
        if sb:
            if sb["recent_chargeoffs"] >= 3:
                add(6, f"{sb['recent_chargeoffs']} SBA charge-offs in 2 years "
                       f"(${sb['recent_chargeoff_amt'] / 1e6:,.1f}M)")
            if (sb["chargeoff_rate"] or 0) >= 5 and sb["loans"] >= 50:
                add(6, f"SBA book {sb['chargeoff_rate']:.1f}% charged off")
            if sb["recent_chargeoffs"] and "business" not in r["hot_segments"]:
                r["hot_segments"].append("business")

        if r["kind"] in ("servicer", "agency"):
            s = min(s, 20)
        r["score"] = max(0, min(100, s))
        r["why"] = why
        r["tier"] = ("call" if r["score"] >= 55 else "watch" if r["score"] >= 35 else "background")
        out.append(r)

    out.sort(key=lambda r: (-r["score"], r["name"]))
    buyers.sort(key=lambda b: -b["count"])
    return {"lenders": out, "buyers": buyers,
            "sba_recent": [x for x in (sba or {}).get("recent", [])][:400]}


def mark_changes(lenders: list[dict], previous: dict | None) -> None:
    """Flag lenders that are new to the call/watch tiers or moved a lot."""
    prev = {l["id"]: l for l in (previous or {}).get("lenders", [])}
    for l in lenders:
        p = prev.get(l["id"])
        l["prev_score"] = p["score"] if p else None
        l["score_change"] = l["score"] - p["score"] if p else None
        was = p["tier"] if p else "background"
        l["is_new"] = bool(previous) and l["tier"] != "background" and was == "background"
        pf = (p or {}).get("foreclosures") or {}
        cf = l.get("foreclosures") or {}
        seen = {f["case_number"] for f in pf.get("filings", [])}
        l["new_filings"] = [f["case_number"] for f in cf.get("filings", [])
                            if previous and f["case_number"] not in seen]
