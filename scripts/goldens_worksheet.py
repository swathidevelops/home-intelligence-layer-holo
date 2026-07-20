"""Render data/goldens.json as a printable labelling worksheet -> data/goldens_worksheet.md.

Read-only with respect to goldens.json: it never writes labels back, so running it
is always safe even after you have started (or finished) labelling.

Run: `py scripts/goldens_worksheet.py`
"""

import json
from pathlib import Path


def dash(v):
    return "-" if v is None else v


def main():
    root = Path(__file__).resolve().parent.parent
    goldens = json.loads((root / "data" / "goldens.json").read_text(encoding="utf-8"))
    cases = goldens["cases"]

    lines = []
    lines.append("# Golden set labelling worksheet")
    lines.append("")
    lines.append(
        "Tick one label per case, then copy your choices into `data/goldens.json` "
        "(`label` field). Judge from the facts below only."
    )
    lines.append("")
    lines.append("- **STALLED** - at risk but still engaged / recoverable (call or nudge).")
    lines.append(
        "- **RATIONAL_PAUSE** - at risk, silent since costs were disclosed (valuation+), "
        "likely re-evaluating (route to nurture)."
    )
    lines.append(
        "- **HEALTHY** - not an active at-risk stall (moving normally, or only a cross-sell)."
    )
    lines.append("")
    lines.append("---")
    lines.append("")

    for i, c in enumerate(cases, start=1):
        f = c["_facts"]
        aed = f"AED {c['expected_commission']:,}"
        lines.append(
            f"### {i}. {c['id']} — {c['stage']} · {c['segment']} · "
            f"{c['property_type']} · {c['purpose']}"
        )
        lines.append(f"- Client: {c['client_name']}  |  expected commission: {aed}")
        lines.append(
            f"- In current stage: **{f['days_in_current_stage']}d**  |  "
            f"last inbound: **{dash(f['days_since_last_inbound'])}d ago**  |  "
            f"last activity: **{dash(f['days_since_last_activity'])}d ago**"
        )
        lines.append(
            f"- Last 10 days — outbound: {f['outbound_last_10_days']}, "
            f"inbound: {f['inbound_last_10_days']}"
        )
        lines.append(
            f"- Valuation: {f['valuation_status']}  |  docs outstanding: "
            f"{f['docs_outstanding']}  |  services: "
            f"{', '.join(f['services_attached']) or 'none'}"
        )
        lines.append(
            f"- Pre-approval expires in: {dash(f['pre_approval_expires_in_days'])}d  |  "
            f"next milestone due in: {dash(f['next_milestone_due_in_days'])}d  |  "
            f"handover in: {dash(f['handover_in_days'])}d  |  "
            f"transfer: {dash(f['transfer_type'])}"
        )
        touches = "; ".join(
            f"{a['days_ago']}d {a['direction'][:3]} {a['channel']}/{a['type']}"
            for a in c["_recent_activity"]
        )
        lines.append(f"- Recent: {touches}")
        lines.append("")
        lines.append("  Label:  ☐ STALLED   ☐ RATIONAL_PAUSE   ☐ HEALTHY")
        lines.append("")

    out = root / "data" / "goldens_worksheet.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {len(cases)} cases -> {out}")


if __name__ == "__main__":
    main()
