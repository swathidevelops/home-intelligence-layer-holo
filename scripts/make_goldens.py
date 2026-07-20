"""Select 30 diverse golden cases -> data/goldens.json (empty labels, for hand-labelling).

Picks a spread across every planted pattern plus clean healthy cases so the gold
set spans the full decision space. The engine's own signals are used ONLY to
choose a diverse sample -- never to fill in the label. Each case is emitted with:
  - label: ""                    (you fill: STALLED | RATIONAL_PAUSE | HEALTHY)
  - the full raw case fields     (so the eval can run the classifier on it)
  - _facts: neutral date arithmetic (dwell, days since contact, expiries, ...)
  - _recent_activity: the last few touches in plain form

No flag codes and no classification appear anywhere in the output: the labelling
is your judgment, which is exactly what the eval measures the classifier against.

Run: `py scripts/make_goldens.py`
"""

import json
from pathlib import Path

import generate_cases as g  # detectors + helpers, all anchored to REFERENCE_DATE

NOW = g.NOW
FINAL_OFFER_IDX = g.FINAL_OFFER_IDX
STAGE_INDEX = g.STAGE_INDEX


def load_cases():
    path = Path(__file__).resolve().parent.parent / "data" / "cases.json"
    return json.loads(path.read_text(encoding="utf-8"))


def facts_for(case):
    """Neutral, judgment-free arithmetic to make hand-labelling humane."""
    sidx = STAGE_INDEX[case["stage"]]

    pre_exp = None
    if case["pre_approval_date"] and sidx < FINAL_OFFER_IDX:
        pre_exp = (g.d(case["pre_approval_date"]) + g.timedelta(days=60) - NOW).days

    next_ms = None
    if case["property_type"] == "offplan" and case["payment_milestones"]:
        upcoming = [
            (g.d(m["due_date"]) - NOW).days
            for m in case["payment_milestones"]
            if (g.d(m["due_date"]) - NOW).days >= 0
        ]
        if upcoming:
            next_ms = min(upcoming)

    handover_in = None
    if case["property_type"] == "offplan" and case["handover_date"]:
        handover_in = (g.d(case["handover_date"]) - NOW).days

    return {
        "days_in_current_stage": g.cur_dwell(case),
        "days_since_last_inbound": g.last_inbound(case),
        "days_since_last_activity": min(
            (g.days_ago(a["date"]) for a in case["activities"]), default=None
        ),
        "outbound_last_10_days": g.count_dir_last(case, "outbound", 10),
        "inbound_last_10_days": g.count_dir_last(case, "inbound", 10),
        "valuation_status": case["valuation_status"],
        "docs_outstanding": case["docs_outstanding"],
        "pre_approval_expires_in_days": pre_exp,
        "next_milestone_due_in_days": next_ms,
        "handover_in_days": handover_in,
        "transfer_type": case["transfer_type"],
        "services_attached": case["services_attached"],
    }


def recent_activity(case, n=5):
    ordered = sorted(case["activities"], key=lambda a: a["date"], reverse=True)[:n]
    return [
        {
            "days_ago": g.days_ago(a["date"]),
            "direction": a["direction"],
            "channel": a["channel"],
            "type": a["type"],
        }
        for a in ordered
    ]


def main():
    cases = load_cases()
    p75 = g.p75_by_stage(cases)
    by_id = {c["id"]: c for c in cases}

    def flags(c):
        return g.risk_flags(c, p75)

    def cls(c):
        return g.classify(c, p75)

    # Buckets by situation (sorted by id for deterministic selection).
    def bucket(pred):
        return sorted((c["id"] for c in cases if pred(c)))

    rational_pause = bucket(lambda c: cls(c) == "RATIONAL_PAUSE")
    p1_stalled = bucket(lambda c: g.detect_p1(c, p75) and cls(c) == "STALLED")
    payment_cliff = bucket(lambda c: "PAYMENT_CLIFF" in flags(c))
    valuation_overdue = bucket(lambda c: "VALUATION_OVERDUE" in flags(c))
    transfer_tunnel = bucket(lambda c: "TRANSFER_TUNNEL" in flags(c))
    pre_expiry = bucket(lambda c: "PRE_APPROVAL_EXPIRY" in flags(c))
    docs_stuck = bucket(lambda c: "DOCS_STUCK" in flags(c))
    gone_quiet = bucket(lambda c: "GONE_QUIET" in flags(c))
    life_gap = bucket(lambda c: "LIFE_INSURANCE_GAP" in g.cross_sell(c))
    handover = bucket(lambda c: "HANDOVER_PIPELINE" in g.cross_sell(c))
    dbr = bucket(lambda c: g.dbr_switch(c))
    healthy = bucket(lambda c: len(flags(c)) == 0)

    # Healthy sample spread across distinct stages for variety.
    healthy_spread = []
    seen_stage = set()
    for cid in healthy:
        st = by_id[cid]["stage"]
        if st not in seen_stage:
            healthy_spread.append(cid)
            seen_stage.add(st)
    healthy_rest = [cid for cid in healthy if cid not in healthy_spread]

    # Assembly plan (ordered so every class is represented before padding).
    plan = [
        ("rational_pause", rational_pause, 4),
        ("p1_stalled", p1_stalled, 3),
        ("payment_cliff", payment_cliff, 2),
        ("valuation_overdue", valuation_overdue, 2),
        ("transfer_tunnel", transfer_tunnel, 2),
        ("pre_approval_expiry", pre_expiry, 2),
        ("docs_stuck", docs_stuck, 2),
        ("gone_quiet", gone_quiet, 1),
        ("life_insurance_gap", life_gap, 2),
        ("handover_pipeline", handover, 2),
        ("dbr_switch", dbr, 2),
        ("healthy_by_stage", healthy_spread, 6),
    ]

    selected, provenance = [], {}
    for name, ids, count in plan:
        added = 0
        for cid in ids:
            if added >= count:
                break
            if cid not in selected:
                selected.append(cid)
                provenance[cid] = name
                added += 1

    # Pad to exactly 30 from remaining healthy, then any remaining case.
    for cid in healthy_rest + sorted(by_id):
        if len(selected) >= 30:
            break
        if cid not in selected:
            selected.append(cid)
            provenance.setdefault(cid, "healthy_extra")

    selected = selected[:30]

    goldens = {
        "_instructions": (
            "Fill each case's \"label\" with one of STALLED, RATIONAL_PAUSE, or HEALTHY, "
            "using only the _facts and _recent_activity shown. Do not run the engine. "
            "STALLED = at risk but the client is still engaged and recoverable (worth a call or nudge). "
            "RATIONAL_PAUSE = at risk and the client has gone silent since costs were disclosed "
            "(valuation or later) and is likely re-evaluating (route to nurture, stop active RM time). "
            "HEALTHY = not an active at-risk stall (moving normally, or only a cross-sell opportunity)."
        ),
        "_label_options": ["STALLED", "RATIONAL_PAUSE", "HEALTHY"],
        "cases": [],
    }

    for cid in selected:
        c = by_id[cid]
        entry = {
            "label": "",
            "id": c["id"],
            "client_name": c["client_name"],
            "stage": c["stage"],
            "segment": c["segment"],
            "residency": c["residency"],
            "purpose": c["purpose"],
            "property_type": c["property_type"],
            "property_price": c["property_price"],
            "loan_amount": c["loan_amount"],
            "expected_commission": c["expected_commission"],
            "_facts": facts_for(c),
            "_recent_activity": recent_activity(c),
        }
        goldens["cases"].append(entry)

    out = Path(__file__).resolve().parent.parent / "data" / "goldens.json"
    out.write_text(json.dumps(goldens, indent=2), encoding="utf-8")

    # Summary (situation provenance only -- NOT labels).
    print("=" * 60)
    print(f"  Selected {len(selected)} golden cases -> {out.name}")
    print("=" * 60)
    counts = {}
    for cid in selected:
        counts[provenance[cid]] = counts.get(provenance[cid], 0) + 1
    print("  Situation spread (for coverage, not labels):")
    for name in [p[0] for p in plan] + ["healthy_extra"]:
        if name in counts:
            print(f"    {name:<22} {counts[name]}")
    print()
    stage_counts = {}
    for cid in selected:
        st = by_id[cid]["stage"]
        stage_counts[st] = stage_counts.get(st, 0) + 1
    print("  Stage spread:")
    for st in g.STAGES:
        if st in stage_counts:
            print(f"    {st:<16} {stage_counts[st]}")
    print()
    print("  Next: open data/goldens.json and set each \"label\" by hand.")


if __name__ == "__main__":
    main()
