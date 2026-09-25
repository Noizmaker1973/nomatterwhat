"""
NoteLine — weekly run.

    python run.py --out site

    FDIC call reports  -> which banks are carrying non-performing loans, and
                          whether the pile is growing
    Deedline filings   -> which lenders are foreclosing in Massachusetts now,
                          with the addresses
    SBA FOIA file      -> which lenders are charging off business loans
        -> one scored lender list
        -> lenders.json + lenders.csv + dashboard.html

Each source is optional except the FDIC. When one fails the run carries on
without it and says so in the output, the way Deedline treats a missing report.

For tests and offline runs, --fdic-cache points at a JSON file holding
{"institutions": [...], "financials": [...]} instead of calling the API.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from noteline import foreclosures, sba as sba_mod, score  # noqa: E402
from noteline.fdic import FDIC, bank_metrics              # noqa: E402

HERE = Path(__file__).resolve().parent

CSV_COLS = ["score", "tier", "name", "kind", "city", "state", "assets_musd", "nc_ratio",
            "nc_ratio_year_ago", "noncurrent_musd", "texas_ratio", "leverage", "roa",
            "hot_segments", "ma_foreclosures_12mo", "ma_foreclosures_30d",
            "sba_chargeoffs_2y", "why", "web", "fdic_url"]


def load_json(p: Path, default=None):
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def fetch_fdic(cfg: dict, cache: Path | None, extra_names: list[str]) -> tuple[list, list]:
    if cache:
        data = json.loads(cache.read_text())
        return data["institutions"], data["financials"]
    api = FDIC()
    insts = api.institutions()
    states = set(cfg.get("states") or [])
    certs = {int(i["CERT"]) for i in insts if not states or i.get("STALP") in states}
    # Out-of-state banks foreclosing here get their numbers too.
    from noteline.lenders import BankIndex, classify
    idx = BankIndex(insts)
    for n in extra_names:
        if classify(n) == "portfolio":
            hit = idx.match(n, cfg.get("foreclosure_state"))
            if hit:
                certs.add(int(hit["CERT"]))
    print(f"FDIC: {len(insts)} active banks, fetching call reports for {len(certs)}")
    return insts, api.financials(sorted(certs))


def write_csv(path: Path, lenders: list[dict]) -> None:
    def musd(v):
        return round(v / 1000, 2) if v is not None else ""
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for l in lenders:
            b, p = l.get("bank") or {}, l.get("prior") or {}
            fc, sb = l.get("foreclosures") or {}, l.get("sba") or {}
            w.writerow([l["score"], l["tier"], l["name"], l["kind"], l["city"], l["state"],
                        musd(b.get("assets")), b.get("nc_ratio", ""), p.get("nc_ratio", ""),
                        musd(b.get("noncurrent")), b.get("texas_ratio", ""),
                        b.get("leverage", ""), b.get("roa", ""),
                        " ".join(l.get("hot_segments", [])), fc.get("count", ""),
                        fc.get("last_30", ""), sb.get("recent_chargeoffs", ""),
                        "; ".join(l["why"]), l.get("web", ""), l.get("fdic_url", "")])


def render(template: Path, payload: dict) -> str:
    data = json.dumps(payload, separators=(",", ":")).replace("</", "<\\/")
    return template.read_text().replace("/*__NOTELINE_DATA__*/null", data)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "config.json"))
    ap.add_argument("--out", default=str(HERE / "site"))
    ap.add_argument("--template", default=str(HERE / "dashboard-template.html"))
    ap.add_argument("--fdic-cache", help="offline: JSON with institutions + financials")
    ap.add_argument("--deedline", help="path to Deedline leads.json (overrides config)")
    ap.add_argument("--sba", action="append", help="SBA FOIA CSV path/URL (overrides config)")
    a = ap.parse_args(argv)

    cfg = json.loads(Path(a.config).read_text())
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sources: dict[str, str] = {}

    # Foreclosures first: their lender names widen the FDIC fetch.
    history = load_json(out / "foreclosure_history.json", {}) or {}
    try:
        dl = foreclosures.load_deedline(a.deedline or cfg.get("deedline_source"))
        if dl is None:
            sources["deedline"] = "not connected (set DEEDLINE_TOKEN — see SETUP.md)"
        else:
            history = foreclosures.merge_history(history, dl)
            sources["deedline"] = f"ok — {len(history['cases'])} filings in history"
    except Exception as e:  # noqa: BLE001 — a source failing must not sink the run
        traceback.print_exc()
        sources["deedline"] = f"failed: {e}"
    groups = foreclosures.by_lender(history, cfg.get("foreclosure_window_days", 365),
                                    overrides=cfg.get("lender_overrides"))

    insts, fin = fetch_fdic(cfg, Path(a.fdic_cache) if a.fdic_cache else None,
                            [g["name"] for g in groups.values()])
    metrics = bank_metrics(fin)
    latest_q = max((m["latest"]["repdte"] for m in metrics.values()), default="")
    sources["fdic"] = f"ok — {len(metrics)} banks, call reports through {latest_q}"

    sba_data = None
    sba_cfg = cfg.get("sba") or {}
    sba_src = a.sba or (sba_cfg.get("csv_urls") if sba_cfg.get("enabled") else None)
    if sba_src:
        try:
            sba_data = sba_mod.scan(sba_src, set(cfg.get("states") or []) or None,
                                    sba_cfg.get("recent_days", 730))
            sources["sba"] = (f"ok — {len(sba_data['lenders'])} lenders, "
                              f"{len(sba_data['recent'])} recent charge-offs in your states")
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            sources["sba"] = f"failed: {e}"
    else:
        sources["sba"] = "off (see SETUP.md to add business loans)"

    result = score.build(insts, metrics, groups, sba_data, cfg)
    previous = load_json(out / "lenders.json")
    score.mark_changes(result["lenders"], previous)

    payload = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "states": cfg.get("states"),
        "call_report_quarter": latest_q,
        "sources": sources,
        **result,
    }
    (out / "lenders.json").write_text(json.dumps(payload, indent=1))
    (out / "foreclosure_history.json").write_text(json.dumps(history, indent=1))
    write_csv(out / "lenders.csv", result["lenders"])
    if Path(a.template).exists():
        (out / "dashboard.html").write_text(render(Path(a.template), payload))

    tiers = {t: sum(1 for l in result["lenders"] if l["tier"] == t)
             for t in ("call", "watch", "background")}
    for k, v in sources.items():
        print(f"{k}: {v}")
    print(f"{len(result['lenders'])} lenders scored — {tiers['call']} worth a call, "
          f"{tiers['watch']} to watch; {len(result['buyers'])} active note buyers seen")
    return 0


if __name__ == "__main__":
    sys.exit(main())
