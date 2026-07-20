"""AI brief generator -> data/ai_briefs.json (Claude API, run locally once).

For the top 20 risk-flagged cases by priority score, calls the Anthropic API once
per case to produce, per CLAUDE.md Prompt 5:
  - a 3-sentence RM brief (situation / risk / why it matters in AED)
  - a WhatsApp intervention draft the RM could edit and send (< 60 words, warm,
    specific, no pressure tactics), matched to the engine's recommended action.

The tone is guided by the engine's classification and pause kind: STALLED cases
get a call/nudge, customer-paused cases get no-rush rate-watch framing, and
process-blocked (transfer-tunnel) cases get a reassuring "we're chasing the bank"
status update — never a cross-sell.

Structured outputs (`output_config.format`) guarantee parseable {brief, whatsapp}
JSON. Outputs are committed to data/ai_briefs.json; THE DEPLOYED APP NEVER CALLS
ANY API. After generating, re-runs run_evals.py so the LLM-brief pass rate lands
in data/eval_results.json.

Setup (once):
  py -m pip install anthropic
  copy .env.example .env   # then put your key in .env  (ANTHROPIC_API_KEY=sk-ant-...)
Run:
  py scripts/generate_ai_briefs.py   (or `npm run gen:briefs`)
"""

import json
import os
import sys
from pathlib import Path

import generate_cases as g
from make_goldens import facts_for  # neutral per-case fact block (reused)

ROOT = Path(__file__).resolve().parent.parent

# CLAUDE.md names "claude-sonnet-4-6", which predates the current Sonnet. Sonnet 5
# is the current Sonnet tier (near-Opus quality at Sonnet cost) and the right fit
# for short, warm brief generation. Override with the BRIEF_MODEL env var.
MODEL = os.environ.get("BRIEF_MODEL", "claude-sonnet-5")
TOP_N = 20

STAGE_PROBABILITY = {
    "lead": 0.15, "pre_approval": 0.35, "property_found": 0.50, "application": 0.55,
    "valuation": 0.65, "final_offer": 0.85, "signed": 0.95, "disbursed": 1.0,
}

FLAG_LABELS = {
    "VELOCITY_STALL": "Stuck longer than normal",
    "PAYMENT_CLIFF": "Big payment due, client silent",
    "PRE_APPROVAL_EXPIRY": "Pre-approval expiring soon",
    "TRANSFER_TUNNEL": "Quiet during transfer wait",
    "GONE_QUIET": "Not responding to outreach",
    "VALUATION_OVERDUE": "Valuation taking too long",
    "DOCS_STUCK": "Documents holding this up",
}

STAGE_LABEL = {
    "lead": "lead", "pre_approval": "pre-approval", "property_found": "property search",
    "application": "application", "valuation": "valuation", "final_offer": "final offer",
    "signed": "signing", "disbursed": "disbursed",
}

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "brief": {"type": "string"},
        "whatsapp": {"type": "string"},
    },
    "required": ["brief", "whatsapp"],
    "additionalProperties": False,
}

SYSTEM = """You write internal briefs and client-ready WhatsApp drafts for relationship managers (RMs) at a UAE residential-mortgage brokerage. Tone: warm, professional, GCC-appropriate, concise.

Hard rules — a draft that breaks any of these is discarded:
- Use ONLY the facts and numbers provided. Never invent numbers, dates, weekday or month names, place or area names, developer or project names, bank names, or people. Write AED amounts exactly as given, with thousands separators (or one-decimal millions).
- Greet the client by their first name only. No honorifics, no transliterated Arabic greetings — write in English.
- No pressure tactics, no fake scarcity, no deadlines the client didn't set.
- Match the recommended action exactly:
  - STALLED: the client is still engaged. Offer a quick call or chat to help move things forward.
  - RATIONAL_PAUSE / customer paused: the client stepped back after seeing costs. Do NOT mention insurance, conveyancing, or signing, and do NOT create urgency. Keep them warm with a rate-watch framing (investment purpose) or a rent-vs-buy framing (end-use purpose); make clear there is no rush and you'll reach out when the numbers move.
  - RATIONAL_PAUSE / process blocked: the client is fine but the bank transfer is stuck. Send a short, reassuring status update — you are chasing the bank on their behalf and nothing is needed from them. No cross-sell, no urgency.
  - HEALTHY / early warning: a time-sensitive deadline is approaching but the client is engaged. A helpful, proactive heads-up.

Return JSON:
- "brief": exactly three sentences for the RM — (1) the situation, (2) the risk, (3) why it matters in AED.
- "whatsapp": a message the RM could send the client, UNDER 60 words, addressed to them by first name, specific to their situation."""


def load_env():
    """Minimal .env loader (no python-dotenv dependency)."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def staleness_decay(case):
    days = min((g.days_ago(a["date"]) for a in case["activities"]), default=None)
    if days is None:
        return 0.2
    if days < 7:
        return 1.0
    if days < 14:
        return 0.7
    if days < 30:
        return 0.4
    return 0.2


def priority(case):
    return case["expected_commission"] * STAGE_PROBABILITY[case["stage"]] * staleness_decay(case)


def action_for(case, p75):
    """Mirror lib/engine.ts: classification -> (label, pause_kind, action text)."""
    cls = g.classify(case, p75)
    if cls == "STALLED":
        return cls, None, "Call or send a personal nudge."
    if cls == "RATIONAL_PAUSE":
        kind = g.pause_kind(case, p75)
        if kind == "process_blocked":
            return (cls, kind,
                    "Chase the bank or conveyancer for a transfer status update. Do not nurture the customer.")
        return cls, kind, "Move to rate-watch nurture and stop active RM time."
    return cls, None, "Act on the time-sensitive alert; no stall recovery needed."


def build_user_message(case, p75, cls, kind, action):
    facts = facts_for(case)
    flags = sorted(g.risk_flags(case, p75))
    first_name = case["client_name"].split()[0]

    citeable = [
        f"Expected commission at stake: AED {case['expected_commission']:,}",
        f"Property price: AED {case['property_price']:,}",
        f"Loan amount: AED {case['loan_amount']:,}",
        f"Days in current stage: {facts['days_in_current_stage']}",
    ]
    if facts["days_since_last_inbound"] is not None:
        citeable.append(f"Days since the client last replied: {facts['days_since_last_inbound']}")
    if facts["pre_approval_expires_in_days"] is not None:
        citeable.append(f"Pre-approval expires in: {facts['pre_approval_expires_in_days']} days")
    if facts["next_milestone_due_in_days"] is not None:
        citeable.append(f"Next payment milestone due in: {facts['next_milestone_due_in_days']} days")
    if facts["handover_in_days"] is not None:
        citeable.append(f"Handover in: {facts['handover_in_days']} days")
    if "DOCS_STUCK" in flags:
        citeable.append(f"Documents outstanding: {facts['docs_outstanding']}")
    if "VALUATION_OVERDUE" in flags and case.get("valuation_requested_date"):
        wd = g.working_days_since(case["valuation_requested_date"])
        citeable.append(f"Valuation requested {wd} working days ago (SLA is 5)")

    purpose_hint = ("end-use — they will live in it" if case["purpose"] == "end_use"
                    else "investment — rental yield / rate driven")

    lines = [
        f"Client first name: {first_name}",
        f"Stage: {STAGE_LABEL[case['stage']]}",
        f"Classification: {cls}" + (f" ({kind})" if kind else ""),
        f"Recommended action: {action}",
        f"Purpose: {purpose_hint}",
        "",
        "Why it is flagged:",
        *[f"  - {FLAG_LABELS[c]}" for c in flags],
        "",
        "Facts you may cite (use only these numbers):",
        *[f"  - {c}" for c in citeable],
    ]
    return "\n".join(lines)


def word_count(text):
    return len((text or "").split())


def main():
    load_env()
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise SystemExit(
            "No API key found. Put ANTHROPIC_API_KEY=... in .env "
            "(copy .env.example to .env first). The key is never committed or deployed."
        )
    try:
        import anthropic
    except ImportError:
        raise SystemExit("Anthropic SDK not installed. Run:  py -m pip install anthropic")

    cases = json.loads((ROOT / "data" / "cases.json").read_text(encoding="utf-8"))
    p75 = g.p75_by_stage(cases)

    flagged = [c for c in cases if g.risk_flags(c, p75)]
    flagged.sort(key=priority, reverse=True)
    selected = flagged[:TOP_N]
    print(f"Selected top {len(selected)} risk-flagged cases by priority score.\n")

    client = anthropic.Anthropic()
    briefs = []
    for i, case in enumerate(selected, start=1):
        cls, kind, action = action_for(case, p75)
        user_msg = build_user_message(case, p75, cls, kind, action)
        label = f"{case['id']} {case['client_name']} [{cls}{'/' + kind if kind else ''}]"
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=1024,
                thinking={"type": "disabled"},  # short creative text; no thinking needed
                system=SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
                output_config={"format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
            )
            text = next(b.text for b in resp.content if b.type == "text")
            parsed = json.loads(text)
        except Exception as exc:  # keep going; one failure shouldn't lose the batch
            print(f"  [{i:>2}] {label}  -> ERROR: {exc}")
            continue

        entry = {
            "case_id": case["id"],
            "client_name": case["client_name"],
            "stage": case["stage"],
            "priority_score": round(priority(case)),
            "classification": cls,
            "pause_kind": kind,
            "recommended_action": action,
            "flags": sorted(g.risk_flags(case, p75)),
            "brief": parsed["brief"].strip(),
            "whatsapp": parsed["whatsapp"].strip(),
        }
        briefs.append(entry)
        wc = word_count(entry["whatsapp"])
        flag = "" if wc < 60 else "  <-- OVER 60 WORDS, review"
        print(f"  [{i:>2}] {label}  (WhatsApp {wc}w){flag}")

    out = ROOT / "data" / "ai_briefs.json"
    out.write_text(json.dumps(briefs, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(briefs)} briefs -> {out}")

    # Print all drafts for review (you are the quality gate).
    print("\n" + "=" * 72)
    print("  REVIEW ALL DRAFTS")
    print("=" * 72)
    for e in briefs:
        print(f"\n--- {e['case_id']}  {e['client_name']}  [{e['classification']}"
              f"{'/' + e['pause_kind'] if e['pause_kind'] else ''}] ---")
        print(f"BRIEF:    {e['brief']}")
        print(f"WHATSAPP: {e['whatsapp']}")

    # Re-run evals so the brief pass rate lands in eval_results.json.
    print("\n" + "=" * 72)
    print("  RUNNING BRIEF EVAL")
    print("=" * 72)
    import run_evals
    run_evals.main()


if __name__ == "__main__":
    main()
