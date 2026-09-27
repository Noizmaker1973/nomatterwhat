"""
The call brief: what to say to a lender's special assets officer.

Built from the same facts the score uses, so every line is something the bank
will recognise as true about itself. Three parts:

  talking points   the handful of numbers worth having in front of you
  the ask          what you want, in one breath
  letter           a short first-contact letter or email, ready to edit

The tracker can have Claude rewrite the letter in your own words; this
version needs no API key and is always there.
"""

from __future__ import annotations

from datetime import date

SEG_WORDS = {"residential": "1–4 family", "cre": "commercial real estate",
             "business": "business loans"}


def _m(k: float | None) -> str:
    if k is None:
        return "?"
    return f"${k / 1e6:.1f}B" if k >= 1e6 else f"${k / 1000:.1f}M" if k >= 1000 else f"${k:.0f}K"


def _q(repdte: str) -> str:
    if len(repdte or "") == 8:
        return f"Q{(int(repdte[4:6]) + 2) // 3} {repdte[:4]}"
    return repdte or ""


def build(l: dict, buyer: dict, states: list[str]) -> dict:
    b, p = l.get("bank") or {}, l.get("prior") or {}
    fc = l.get("foreclosures") or {}
    sold = l.get("sold") or {}
    points: list[str] = []

    if b.get("nc_ratio") is not None:
        basis = b.get("basis") or "noncurrent"
        line = f"{b['nc_ratio']:.2f}% of loans {basis} ({_m(b.get('noncurrent'))}) as of {_q(b.get('repdte'))}"
        if p.get("nc_ratio") is not None:
            line += f", up from {p['nc_ratio']:.2f}% a year earlier" if b["nc_ratio"] > p["nc_ratio"] \
                else f", down from {p['nc_ratio']:.2f}% a year earlier"
        points.append(line)
    hot = [SEG_WORDS[s] for s in l.get("hot_segments", []) if s in SEG_WORDS]
    if hot:
        points.append("Trouble concentrated in " + ", ".join(hot))
    if b.get("oreo"):
        points.append(f"{_m(b['oreo'])} in foreclosed property on the books")
    if b.get("texas_ratio") is not None and b["texas_ratio"] >= 25:
        points.append(f"Texas ratio {b['texas_ratio']:.0f}%")
    if fc.get("count"):
        points.append(f"{fc['count']} Massachusetts foreclosure filing{'s' if fc['count'] != 1 else ''}"
                      f" in its own name in the last year, {fc.get('last_90', 0)} in the last 90 days")
    if sold.get("sales"):
        who = ", ".join(n for n, _ in sold["buyers"][:2])
        points.append(f"Has sold notes before — {sold['sales']} on record"
                      + (f", most recently {sold['last_date']}" if sold.get("last_date") else "")
                      + (f", to {who}" if who else ""))
    sba = l.get("sba") or {}
    if sba.get("recent_chargeoffs"):
        points.append(f"{sba['recent_chargeoffs']} SBA loans charged off in the last two years")

    loans = [f for f in fc.get("filings", [])][:5]
    named = [f"{f['street']}, {f['city']}" for f in loans if f.get("street")]

    kinds = []
    if "residential" in l.get("hot_segments", []) or fc.get("count") or not l.get("cert"):
        kinds.append("1–4 family")
    if "cre" in l.get("hot_segments", []):
        kinds.append("small commercial and multifamily")
    if "business" in l.get("hot_segments", []):
        kinds.append("real-estate-secured business loans")
    kinds = kinds or ["residential and small commercial"]
    what = " and ".join([", ".join(kinds[:-1]), kinds[-1]] if len(kinds) > 1 else kinds)

    me = buyer.get("name") or "[Your name]"
    co = buyer.get("company") or "[Company]"
    phone = buyer.get("phone") or "[phone]"
    email = buyer.get("email") or "[email]"
    close = buyer.get("close_days") or 30
    where = buyer.get("markets") or ", ".join(states or []) or "New England"

    ask = (f"Do you sell non-performing {what} notes one at a time or in small pools? "
           f"We buy for cash in {where} and close in {close} days"
           + (", and would bid on specific loans you're foreclosing on now." if named else "."))

    specific = ""
    if named:
        specific = ("\n\nIf it's useful to be specific, we'd look at any of the loans your bank has "
                    "in foreclosure in Massachusetts, including:\n" +
                    "\n".join(f"  • {n}" for n in named) + "\n")
    letter = (
        f"Subject: Buying non-performing notes from {l['name']}\n\n"
        f"Dear Special Assets team,\n\n"
        f"{co} buys non-performing and sub-performing {what} notes in {where}. "
        f"We buy one loan at a time or small pools, pay cash, handle the workout through a "
        f"licensed servicer, and close in {close} days with no financing contingency."
        f"{specific}\n"
        f"If {l['name']} ever sells individual loans or small pools, we'd like to be on the "
        f"list. And if there are loans you'd rather resolve this quarter than carry, I'd welcome "
        f"a short call to see whether a sale makes sense.\n\n"
        f"Best regards,\n{me}\n{co}\n{phone} · {email}\n"
    )

    headline = (f"{l['name']} — " + (points[0] if points else "no public distress signals")
                + ("; has sold notes before" if sold.get("sales") else ""))
    return {"headline": headline, "points": points, "ask": ask, "named_loans": named,
            "letter": letter, "generated": date.today().isoformat()}
