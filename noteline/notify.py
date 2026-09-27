#!/usr/bin/env python3
"""
Email the week's lender list — the same shape as Deedline's morning email.

    python notify.py site

Reads lenders.json, lenders.csv and dashboard.html from run.py and sends one
email: lenders new to the list first, then the top of the full list, with the
dashboard and CSV attached. The dashboard is self-contained, so the attachment
is the full interactive view without publishing it anywhere.

Settings (GitHub repository secrets), the same names Deedline uses:

    SMTP_USER, SMTP_PASSWORD, EMAIL_TO, SMTP_HOST, SMTP_PORT

Missing SMTP_USER or SMTP_PASSWORD: prints a note and exits cleanly.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from html import escape
from pathlib import Path

NEW_LIMIT = 25
TOP_LIMIT = 15
SKIP = ("servicer", "agency")

NOTES = [
    "A score means 'worth a call', not 'has notes for sale'. Ask for special assets.",
    "Servicing residential notes in Massachusetts requires a licensed servicer; "
    "940 CMR 25.00 applies to foreclosure-related outreach to homeowners.",
]


def line(l: dict) -> str:
    b = l.get("bank") or {}
    fc = l.get("foreclosures") or {}
    bits = []
    if b.get("nc_ratio") is not None:
        bits.append(f"{b['nc_ratio']:.2f}% noncurrent")
    if fc.get("count"):
        bits.append(f"{fc['count']} MA foreclosures")
    if l.get("sold"):
        bits.append("has sold notes before")
    return ", ".join(bits)


def text_rows(ls: list[dict]) -> str:
    out = []
    for l in ls:
        where = ", ".join(x for x in (l.get("city"), l.get("state")) if x)
        out.append(f"  {l['score']:>3}  {l['name']}  ({where})  {line(l)}")
        out.append(f"       {'; '.join(l['why'][:4])}")
    return "\n".join(out)


def html_table(ls: list[dict]) -> str:
    th = ('<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ccc">{}</th>')
    td = 'style="padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top"'
    head = "<tr>" + "".join(th.format(h) for h in ("Score", "Lender", "Where", "Signal", "Why")) + "</tr>"
    rows = ["<tr>" + "".join(f"<td {td}>{escape(str(v))}</td>" for v in (
        l["score"], l["name"], ", ".join(x for x in (l.get("city"), l.get("state")) if x),
        line(l), "; ".join(l["why"][:4]))) + "</tr>" for l in ls]
    return f'<table style="border-collapse:collapse;font-size:13px">{head}{"".join(rows)}</table>'


def build_message(payload: dict, out: Path) -> EmailMessage:
    ls = [l for l in payload["lenders"] if l["kind"] not in SKIP]
    new = [l for l in ls if l.get("is_new")][:NEW_LIMIT]
    top = [l for l in ls if l["tier"] != "background" and not l.get("is_new")][:TOP_LIMIT]
    n_call = sum(1 for l in ls if l["tier"] == "call")
    day = payload["generated"][:10]
    subject = (f"NoteLine {day}: {len(new)} new, {n_call} worth a call" if new
               else f"NoteLine {day}: {n_call} lender{'s' if n_call != 1 else ''} worth a call")
    status = [f"{k}: {v}" for k, v in payload.get("sources", {}).items()]
    proven = [l for l in ls if l.get("sold") and l["tier"] != "background"]

    text = [subject, "", "The attached dashboard has every lender, the loan types, "
            "the foreclosure addresses and SBA charge-offs.", "", *status, ""]
    if new:
        text += [f"NEW TO THE LIST ({len(new)})", text_rows(new), ""]
    if proven:
        text += [f"PROVEN SELLERS ON THE LIST ({len(proven)})", text_rows(proven[:10]), ""]
    if top:
        text += ["TOP OF THE LIST", text_rows(top), ""]
    text += ["", *NOTES]

    html = ['<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#222">',
            f"<h2 style='margin:0 0 8px'>{escape(subject)}</h2>",
            "<p>Open the attached <b>dashboard</b> for the full interactive view.</p>",
            "<p style='color:#555;font-size:13px'>" + "<br>".join(map(escape, status)) + "</p>"]
    if new:
        html.append(f"<h3>New to the list ({len(new)})</h3>{html_table(new)}")
    if proven:
        html.append(f"<h3>Proven sellers on the list ({len(proven)})</h3>{html_table(proven[:10])}")
    if top:
        html.append(f"<h3>Top of the list</h3>{html_table(top)}")
    html.append("<p style='color:#777;font-size:12px;margin-top:24px'>" +
                "<br>".join(map(escape, NOTES)) + "</p></div>")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg.set_content("\n".join(text))
    msg.add_alternative("".join(html), subtype="html")
    for name, sub, fname in (("dashboard.html", "html", f"noteline-dashboard-{day}.html"),
                             ("lenders.csv", "csv", f"noteline-lenders-{day}.csv")):
        p = out / name
        if p.exists():
            msg.add_attachment(p.read_bytes(), maintype="text", subtype=sub, filename=fname)
    return msg


def send(msg: EmailMessage) -> None:
    user, password = os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"]
    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 465)
    to = [a.strip() for a in (os.environ.get("EMAIL_TO") or user).split(",") if a.strip()]
    msg["From"] = f"NoteLine <{user}>"
    msg["To"] = ", ".join(to)
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=60) as s:
            s.login(user, password)
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            s.starttls(context=ctx)
            s.login(user, password)
            s.send_message(msg)
    print(f"emailed {len(to)} recipient(s): {msg['Subject']}")


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "site")
    if not (os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASSWORD")):
        print("email not configured (SMTP_USER / SMTP_PASSWORD secrets missing) — skipping")
        return 0
    send(build_message(json.loads((out / "lenders.json").read_text()), out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
