"""Eval harness -> data/eval_results.json.

Two evals, per CLAUDE.md:

1. CLASSIFIER EVAL — load the hand-labelled goldens, run the stall/rational-pause
   classifier against the full case records, and report per-class precision,
   recall and F1 plus a 3x3 confusion matrix. Disagreements are listed explicitly:
   a weak class is discussed, never hidden.

2. LLM BRIEF EVAL — programmatic checks on each generated brief:
     (a) every number in the brief exists in the case record
     (b) the recommended action matches the rules engine's output
     (c) no client details that are not present in the data
   Plus the CLAUDE.md length rule for the WhatsApp draft (< 60 words).
   These run automatically once data/ai_briefs.json exists (Prompt 5); until
   then the section is recorded as "not_run".

The classifier used here is the Python mirror in generate_cases.py, which is
parity-tested against lib/engine.ts by lib/engine.integration.test.ts.

Run: `py scripts/run_evals.py`  (or `npm run gen:evals`)
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import generate_cases as g

CLASSES = ["STALLED", "RATIONAL_PAUSE", "HEALTHY"]
ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- #
# Loading
# --------------------------------------------------------------------------- #

def load_json(name):
    path = ROOT / "data" / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- #
# 1. Classifier eval
# --------------------------------------------------------------------------- #

def evaluate_classifier(cases, goldens):
    """Returns the classifier eval block: confusion matrix + per-class metrics."""
    p75 = g.p75_by_stage(cases)
    by_id = {c["id"]: c for c in cases}

    pairs = []  # (case_id, gold, predicted)
    unlabelled, missing = [], []
    for entry in goldens["cases"]:
        gold = (entry.get("label") or "").strip().upper()
        cid = entry["id"]
        if not gold:
            unlabelled.append(cid)
            continue
        if gold not in CLASSES:
            raise ValueError(f"{cid}: unknown label {gold!r}; expected one of {CLASSES}")
        case = by_id.get(cid)
        if case is None:
            missing.append(cid)
            continue
        pairs.append((cid, gold, g.classify(case, p75)))

    # Confusion matrix: rows = gold (true), cols = predicted.
    idx = {c: i for i, c in enumerate(CLASSES)}
    matrix = [[0] * len(CLASSES) for _ in CLASSES]
    for _cid, gold, pred in pairs:
        matrix[idx[gold]][idx[pred]] += 1

    per_class = {}
    for c in CLASSES:
        i = idx[c]
        tp = matrix[i][i]
        fn = sum(matrix[i]) - tp                      # gold c, predicted something else
        fp = sum(matrix[r][i] for r in range(len(CLASSES))) - tp
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        per_class[c] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": sum(matrix[i]),
            "true_positives": tp,
            "false_positives": fp,
            "false_negatives": fn,
        }

    n = len(pairs)
    correct = sum(matrix[i][i] for i in range(len(CLASSES)))
    accuracy = correct / n if n else 0.0
    macro = {
        k: round(sum(per_class[c][k] for c in CLASSES) / len(CLASSES), 4)
        for k in ("precision", "recall", "f1")
    }

    # Every disagreement, with the facts that drove the engine's call.
    disagreements = []
    for cid, gold, pred in pairs:
        if gold == pred:
            continue
        case = by_id[cid]
        disagreements.append(
            {
                "id": cid,
                "client_name": case["client_name"],
                "stage": case["stage"],
                "gold_label": gold,
                "predicted": pred,
                "flags": sorted(g.risk_flags(case, p75)),
                "days_in_stage": g.cur_dwell(case),
                "days_since_last_inbound": g.last_inbound(case),
            }
        )

    return {
        "n": n,
        "accuracy": round(accuracy, 4),
        "classes": CLASSES,
        "confusion_matrix": matrix,
        "confusion_matrix_orientation": "rows = hand label (true), cols = engine prediction",
        "per_class": per_class,
        "macro_avg": macro,
        "disagreements": disagreements,
        "unlabelled_cases": unlabelled,
        "cases_not_found_in_book": missing,
    }


# --------------------------------------------------------------------------- #
# 2. LLM brief checks
# --------------------------------------------------------------------------- #

NUMBER_RE = re.compile(r"\d[\d,]*\.?\d*")
WORD_RE = re.compile(r"\b[A-Z][a-zA-Z]+\b")

# Sentence-initial and common capitalised words that are not client details.
COMMON_CAPS = {
    "The", "This", "That", "They", "Their", "There", "These", "Those", "It", "Its",
    "He", "She", "We", "You", "Your", "I", "A", "An", "And", "But", "If", "In", "On",
    "At", "As", "Of", "For", "To", "With", "From", "By", "Since", "After", "Before",
    "When", "While", "Please", "Hi", "Hello", "Hey", "Thanks", "Thank", "Just",
    "Let", "Would", "Could", "Should", "Can", "Will", "Happy", "Good", "Morning",
    "Afternoon", "Evening", "No", "Not", "Now", "Once", "Our", "Us", "Have", "Has",
    "Had", "Do", "Does", "Did", "Is", "Are", "Was", "Were", "Be", "Been", "Am",
    "AED", "DBR", "LTV", "UAE", "Dubai", "WhatsApp", "RM", "Holo", "HOME",
    "Pre", "Valuation", "Mortgage", "Property", "Bank", "Insurance", "Life",
    "Conveyancing", "Handover", "Transfer", "Offer", "Application", "Signed",
    "Disbursed", "Approval", "Rate", "Payment", "Documents", "Docs", "Case",
    "Client", "Days", "Day", "Week", "Weeks", "Month", "Months",
    "Mr", "Mrs", "Ms", "Dr", "Sir", "Madam", "Team",
}


def _normalise_number(token):
    try:
        return float(token.replace(",", ""))
    except ValueError:
        return None


def allowed_numbers(case, p75):
    """Every number a brief may legitimately cite: raw fields + derived day counts."""
    vals = set()

    def add(v):
        if v is None:
            return
        try:
            f = float(v)
        except (TypeError, ValueError):
            return
        vals.add(round(f, 4))

    for key in ("property_price", "loan_amount", "expected_commission",
                "docs_outstanding", "ltv", "dbr"):
        add(case.get(key))

    # percentage forms
    add(round(case["ltv"] * 100))
    add(round(case["dbr"] * 100))

    # AED magnitudes in rounded / millions forms (briefs often say "AED 1.2M")
    for key in ("property_price", "loan_amount", "expected_commission"):
        v = case.get(key)
        if v:
            add(round(v / 1000))
            add(round(v / 1_000_000, 1))
            add(round(v / 1_000_000, 2))
            add(round(v, -3))

    for b in case["bank_options"]:
        add(b["rate"])
        add(b["commission_pct"])
        add(round(b["commission_pct"] * 100, 3))
        add(b["approval_probability"])
        add(round(b["approval_probability"] * 100))
        add(b["avg_days_to_fund"])
        add(b["dbr_limit"])
        add(round(b["dbr_limit"] * 100))

    for m in case.get("payment_milestones") or []:
        add(m["amount"])
        add(round(m["amount"] / 1000))
        add(round(m["amount"] / 1_000_000, 1))
        add((g.d(m["due_date"]) - g.NOW).days)

    # derived day counts the engine's reasons legitimately expose
    add(g.cur_dwell(case))
    add(g.last_inbound(case))
    add(p75.get(case["stage"]))
    if case.get("valuation_requested_date"):
        add(g.working_days_since(case["valuation_requested_date"]))
        add(g.days_ago(case["valuation_requested_date"]))
    if case.get("pre_approval_date"):
        add((g.d(case["pre_approval_date"]) + g.timedelta(days=60) - g.NOW).days)
    if case.get("handover_date"):
        add((g.d(case["handover_date"]) - g.NOW).days)
    for a in case["activities"]:
        add(g.days_ago(a["date"]))

    # fixed rule constants that appear in reasons
    for c in (5, 10, 14, 21, 30, 45, 60, 180):
        add(c)

    return vals


def check_numbers(text, case, p75):
    """(a) every number in the brief exists in the case record."""
    allowed = allowed_numbers(case, p75)
    unsupported = []
    for token in NUMBER_RE.findall(text or ""):
        val = _normalise_number(token)
        if val is None:
            continue
        if not any(abs(val - a) < 0.011 for a in allowed):
            unsupported.append(token)
    return unsupported


def check_action_matches_engine(brief_obj, case, p75):
    """(b) recommended action matches the rules engine output.

    Scans only the model-written brief + WhatsApp (not the echoed engine action),
    and branches RATIONAL_PAUSE by pause kind: a customer-paused case needs
    rate-watch/no-rush framing, a process-blocked case must not add customer
    urgency (the RM chases the bank, not the client)."""
    problems = []
    classification = g.classify(case, p75)
    text = " ".join(
        str(brief_obj.get(k, ""))
        for k in ("brief", "case_brief", "whatsapp", "whatsapp_draft")
    ).lower()

    if classification == "RATIONAL_PAUSE":
        # Suppression rule holds for both pause kinds: no cross-sell push.
        for banned in ("insurance", "conveyancing", "sign now", "sign today", "sign this week"):
            if banned in text:
                problems.append(f"rational-pause case pushes suppressed cross-sell: {banned!r}")
        if g.pause_kind(case, p75) == "customer_paused":
            if not any(w in text for w in ("nurture", "rate", "yield", "rent", "watch",
                                           "no rush", "when you", "take your time", "no pressure")):
                problems.append("customer-paused case has no rate-watch / no-rush framing")
        else:  # process_blocked — reassure, don't pressure
            for urgent in ("urgent", "asap", "immediately"):
                if urgent in text:
                    problems.append(f"process-blocked case adds customer urgency: {urgent!r}")
    elif classification == "STALLED":
        if not any(w in text for w in ("call", "chat", "catch up", "quick", "help",
                                       "hand", "hop on", "ring")):
            problems.append("stalled case has no call/nudge cue")

    explicit = str(brief_obj.get("recommended_action", "")).strip().upper()
    if explicit and explicit in CLASSES and explicit != classification:
        problems.append(f"brief states action for {explicit}, engine says {classification}")
    return problems


def check_no_invented_details(text, case):
    """(c) no client details that are not present in the data."""
    known = set(COMMON_CAPS)
    known.update(case["client_name"].split())
    known.update(case["assigned_rm"].split())
    for b in case["bank_options"]:
        known.update(b["bank_name"].replace("-", " ").split())
    known.update(s.title() for s in case["services_attached"])

    suspicious = [w for w in WORD_RE.findall(text or "") if w not in known]
    return sorted(set(suspicious))


def check_whatsapp_length(text, limit=60):
    words = len((text or "").split())
    return [f"WhatsApp draft is {words} words, limit is {limit}"] if words > limit else []


def evaluate_briefs(briefs, cases, p75):
    """Run all brief checks; returns the eval block with a pass rate."""
    by_id = {c["id"]: c for c in cases}
    results, passed = [], 0

    for b in briefs:
        cid = b.get("case_id") or b.get("id")
        case = by_id.get(cid)
        if case is None:
            results.append({"id": cid, "passed": False, "failures": ["case not found in book"]})
            continue

        brief_text = b.get("brief") or b.get("case_brief") or ""
        wa_text = b.get("whatsapp") or b.get("whatsapp_draft") or ""
        combined = f"{brief_text}\n{wa_text}"

        failures = []
        bad_numbers = check_numbers(combined, case, p75)
        if bad_numbers:
            failures.append(f"numbers not in case record: {bad_numbers}")
        failures += check_action_matches_engine(b, case, p75)
        invented = check_no_invented_details(combined, case)
        if invented:
            failures.append(f"details not present in data: {invented}")
        failures += check_whatsapp_length(wa_text)

        ok = not failures
        passed += ok
        results.append({"id": cid, "passed": ok, "failures": failures})

    n = len(results)
    return {
        "status": "run",
        "n": n,
        "passed": passed,
        "pass_rate": round(passed / n, 4) if n else 0.0,
        "checks": BRIEF_CHECKS,
        "results": results,
    }


BRIEF_CHECKS = [
    "every number in the brief exists in the case record",
    "recommended action matches the rules engine output",
    "no client details absent from the data",
    "WhatsApp draft under 60 words",
]


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

def print_report(block):
    m = block["confusion_matrix"]
    print("=" * 70)
    print(f"  CLASSIFIER EVAL   n={block['n']}   accuracy={block['accuracy']:.1%}")
    print("=" * 70)
    print()
    print("  Confusion matrix (rows = my label, cols = engine prediction)")
    print()
    header = " " * 22 + "".join(f"{c[:14]:>16}" for c in CLASSES)
    print(header)
    print("  " + "-" * (len(header) - 2))
    for i, c in enumerate(CLASSES):
        row = "".join(f"{v:>16}" for v in m[i])
        print(f"  {c:<20}{row}")
    print()
    print("  Per-class metrics")
    print("  " + "-" * 62)
    print(f"  {'class':<18}{'precision':>11}{'recall':>10}{'f1':>8}{'support':>10}")
    print("  " + "-" * 62)
    for c in CLASSES:
        p = block["per_class"][c]
        print(
            f"  {c:<18}{p['precision']:>11.2f}{p['recall']:>10.2f}"
            f"{p['f1']:>8.2f}{p['support']:>10}"
        )
    print("  " + "-" * 62)
    ma = block["macro_avg"]
    print(f"  {'macro avg':<18}{ma['precision']:>11.2f}{ma['recall']:>10.2f}{ma['f1']:>8.2f}")
    print()

    if block["disagreements"]:
        print(f"  Disagreements ({len(block['disagreements'])}) - shown, not hidden:")
        print("  " + "-" * 62)
        for dis in block["disagreements"]:
            print(
                f"  {dis['id']}  {dis['stage']:<14} mine={dis['gold_label']:<15}"
                f" engine={dis['predicted']}"
            )
            print(
                f"      in stage {dis['days_in_stage']}d, last inbound "
                f"{dis['days_since_last_inbound']}d ago, flags: "
                f"{', '.join(dis['flags']) or 'none'}"
            )
        print()
    else:
        print("  No disagreements: the engine matched every hand label.\n")


def main():
    cases = load_json("cases.json")
    goldens = load_json("goldens.json")
    if cases is None:
        raise SystemExit("data/cases.json not found - run `py scripts/generate_cases.py` first")
    if goldens is None:
        raise SystemExit("data/goldens.json not found - run `py scripts/make_goldens.py` first")

    classifier_block = evaluate_classifier(cases, goldens)

    briefs = load_json("ai_briefs.json")
    if not briefs:  # None or empty placeholder
        brief_block = {
            "status": "not_run",
            "reason": "data/ai_briefs.json not generated yet (Prompt 5, run locally with a key)",
            "checks": BRIEF_CHECKS,
        }
    else:
        brief_block = evaluate_briefs(briefs, cases, g.p75_by_stage(cases))

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reference_date": g.REFERENCE_DATE.isoformat(),
        "classifier": classifier_block,
        "llm_briefs": brief_block,
    }
    path = ROOT / "data" / "eval_results.json"
    path.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print_report(classifier_block)
    if brief_block["status"] == "run":
        print(
            f"  LLM BRIEF EVAL    {brief_block['passed']}/{brief_block['n']} passed "
            f"({brief_block['pass_rate']:.1%})\n"
        )
    else:
        print("  LLM BRIEF EVAL    not run yet (no data/ai_briefs.json)\n")
    print(f"  Wrote -> {path}")


if __name__ == "__main__":
    main()
