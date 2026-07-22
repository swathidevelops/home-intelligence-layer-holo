"""Synthetic case-book generator -> data/cases.json (400 cases).

Generates a reproducible book of 400 UAE residential-mortgage cases with nine
leakage patterns deliberately planted (see CLAUDE.md). The book is anchored to a
fixed REFERENCE_DATE so every risk flag fires deterministically no matter when the
engine runs against it. The rules engine (lib/engine.ts) must treat the same date
as "today" for the flags to line up with what this generator planted.

After writing the JSON, prints:
  - cases per stage, segment / property-type split
  - p75 stage-dwell benchmarks (used by the VELOCITY_STALL rule)
  - each planted pattern: intended count vs. count re-detected from the data
  - full risk-flag / cross-sell / classifier distribution as a cross-check

Run: `py scripts/generate_cases.py`  (or `npm run gen:cases`)
"""

import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

SEED = 42
random.seed(SEED)

# Fixed "today". The engine must use this same anchor. See module docstring.
REFERENCE_DATE = date(2026, 7, 20)
NOW = REFERENCE_DATE

STAGES = [
    "lead",
    "pre_approval",
    "property_found",
    "application",
    "valuation",
    "final_offer",
    "signed",
    "disbursed",
]
STAGE_INDEX = {s: i for i, s in enumerate(STAGES)}
PRE_APPROVAL_IDX = STAGE_INDEX["pre_approval"]
PROPERTY_FOUND_IDX = STAGE_INDEX["property_found"]
APPLICATION_IDX = STAGE_INDEX["application"]
VALUATION_IDX = STAGE_INDEX["valuation"]
FINAL_OFFER_IDX = STAGE_INDEX["final_offer"]
SIGNED_IDX = STAGE_INDEX["signed"]
DISBURSED_IDX = STAGE_INDEX["disbursed"]

RMS = [
    "Chaz Cott",
    "Adriell Arcellana",
    "Emma Jackson",
    "Wajeeh Sayeed",
    "Alex Sammy",
    "April Dagdagan",
]

SOURCE_CHANNELS = ["organic", "agent_referral", "concierge", "paid"]

# Fictional but plausible names spanning the UAE mortgage market's demographics.
FIRST_NAMES = [
    "Ahmed", "Mohammed", "Fatima", "Aisha", "Omar", "Yousef", "Layla", "Sara",
    "Khalid", "Noura", "Hamdan", "Mariam", "Rashid", "Hessa", "Saeed", "Reem",
    "Tariq", "Huda", "Bilal", "Zainab", "Rohan", "Priya", "Anjali", "Vikram",
    "Deepak", "Sneha", "Arjun", "Neha", "James", "Emily", "Daniel", "Sophie",
    "Michael", "Laura", "Thomas", "Hannah", "Andrei", "Elena", "Marco", "Isabella",
    "Chen", "Wei", "Ling", "Hiroshi", "Yuki", "Sami", "Nadia", "Karim", "Dina",
    "Faisal",
]
# UAE ruling-family surnames (Al Maktoum, Al Nahyan, Al Qassimi, Al Sharqi,
# Al Mualla, Al Nuaimi, ...) are deliberately excluded — only common family names.
LAST_NAMES = [
    "Al Marri", "Al Suwaidi", "Al Hashimi", "Al Balushi",
    "Khan", "Sharma", "Patel", "Nair", "Reddy", "Kapoor", "Smith",
    "Johnson", "Williams", "Brown", "Petrov", "Ivanov", "Rossi", "Ferrari", "Wang",
    "Li", "Zhang", "Tanaka", "Haddad", "Nasser", "Farouk", "Mansour", "Rahman",
    "Iqbal", "Costa", "Fernandez", "Mueller", "Schmidt",
]

# Candidate lender pool: (name, rate_range_pct, payout_event, dbr_limit, days_range)
BANK_POOL = [
    ("Emirates NBD", (3.99, 4.69), "disbursal", 0.50, (16, 26)),
    ("First Abu Dhabi Bank", (4.09, 4.79), "disbursal", 0.50, (18, 30)),
    ("Abu Dhabi Commercial Bank", (4.19, 4.99), "approval", 0.45, (14, 24)),
    ("Mashreq", (4.29, 5.09), "approval", 0.45, (12, 22)),
    ("Dubai Islamic Bank", (3.99, 4.75), "disbursal", 0.50, (20, 32)),
    ("Abu Dhabi Islamic Bank", (4.15, 4.89), "disbursal", 0.45, (18, 28)),
    ("RAKBANK", (4.35, 5.19), "approval", 0.45, (12, 20)),
    ("HSBC UAE", (4.09, 4.79), "disbursal", 0.50, (22, 35)),
    ("Standard Chartered", (4.25, 4.95), "approval", 0.50, (20, 30)),
]

# Healthy-book stage weights (realistic funnel with decay).
HEALTHY_STAGE_POOL = (
    ["lead"] * 10
    + ["pre_approval"] * 16
    + ["property_found"] * 15
    + ["application"] * 14
    + ["valuation"] * 12
    + ["final_offer"] * 10
    + ["signed"] * 13
    + ["disbursed"] * 10
)

# Planted-pattern target counts (CLAUDE.md).
PATTERN_TARGETS = {
    "P1_post_valuation_quiet": 25,
    "P2_payment_cliff": 15,
    "P3_life_insurance_gap": 20,
    "P4_pre_approval_expiry": 10,
    "P5_transfer_tunnel": 12,
    "P6_handover_pipeline": 8,
    "P7_valuation_overdue": 15,
    "P8_docs_stuck": 10,
    "P9_dbr_switch": 8,
}


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def iso(d: date) -> str:
    return d.isoformat()


def days_before(n: int) -> str:
    return iso(NOW - timedelta(days=n))


def days_after(n: int) -> str:
    return iso(NOW + timedelta(days=n))


def A(days_ago: int, direction: str, channel: str, typ: str) -> dict:
    """Build one activity `days_ago` days before NOW."""
    return {
        "date": days_before(max(days_ago, 0)),
        "direction": direction,
        "channel": channel,
        "type": typ,
    }


def random_name() -> str:
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def make_stage_history(stage: str, dwell_days: int) -> list:
    """Timestamps for every stage lead..stage; current stage entered dwell_days ago."""
    idx = STAGE_INDEX[stage]
    seq = STAGES[: idx + 1]
    entered = {stage: NOW - timedelta(days=dwell_days)}
    cursor = entered[stage]
    for s in reversed(seq[:-1]):
        cursor = cursor - timedelta(days=random.randint(3, 22))
        entered[s] = cursor
    return [{"stage": s, "entered_at": iso(entered[s])} for s in seq]


def make_bank_options(segment: str, dbr: float, force_switch: bool = False) -> list:
    """2-3 candidate banks, exactly one selected. approval_probability is a static
    per-segment assumption (labelled as such in the UI, never a prediction)."""
    if force_switch:
        # Selected bank's DBR limit sits below the case DBR; another candidate fits.
        low = random.choice([b for b in BANK_POOL if b[3] == 0.45])
        high = random.choice([b for b in BANK_POOL if b[3] == 0.50 and b[0] != low[0]])
        chosen = [low, high]
        if random.random() < 0.5:
            extra = random.choice(
                [b for b in BANK_POOL if b[0] not in (low[0], high[0])]
            )
            chosen.append(extra)
        selected_idx = 0
    else:
        k = random.choice([2, 2, 3])
        chosen = random.sample(BANK_POOL, k)
        selected_idx = random.randrange(len(chosen))

    options = []
    for i, (name, rate_range, payout, dbr_limit, days_range) in enumerate(chosen):
        if segment == "salaried":
            approval = round(random.uniform(0.80, 0.92), 2)
        else:
            approval = round(random.uniform(0.58, 0.76), 2)
        options.append(
            {
                "bank_name": name,
                "rate": round(random.uniform(*rate_range), 2),
                "commission_pct": round(random.uniform(0.005, 0.012), 4),
                "payout_event": payout,
                "approval_probability": approval,  # static assumption, not a prediction
                "avg_days_to_fund": random.randint(*days_range),
                "dbr_limit": dbr_limit,
                "selected": i == selected_idx,
            }
        )
    return options


def default_services(stage_idx: int, source: str) -> list:
    """Progressive service attachment; healthy signed+ cases always carry the
    mandatory life_insurance so the only life-insurance gaps are the planted ones."""
    svcs = []
    if stage_idx >= FINAL_OFFER_IDX and random.random() < 0.55:
        svcs.append("conveyancing")
    if stage_idx >= SIGNED_IDX:
        svcs.append("life_insurance")
        if random.random() < 0.45:
            svcs.append("home_insurance")
    if source == "concierge" and random.random() < 0.5:
        svcs.append("concierge")
    elif random.random() < 0.12:
        svcs.append("concierge")
    return svcs


def default_milestones(price: int) -> list:
    n = random.randint(1, 3)
    ms = []
    for _ in range(n):
        due = random.randint(45, 400)
        amt = round(price * random.uniform(0.05, 0.15) / 1000) * 1000
        ms.append({"due_date": days_after(due), "amount": amt})
    return sorted(ms, key=lambda m: m["due_date"])


def base_demo(force_offplan=None) -> dict:
    segment = random.choice(["salaried", "salaried", "self_employed"])
    residency = random.choice(["resident", "resident", "resident", "non_resident"])
    purpose = random.choice(["end_use", "investment"])
    if force_offplan is True:
        ptype = "offplan"
    elif force_offplan is False:
        ptype = "ready"
    else:
        ptype = "offplan" if random.random() < 0.40 else "ready"
    price = random.randrange(800_000, 2_500_001, 50_000)
    ltv = random.choice([0.75, 0.75, 0.76, 0.78, 0.80])
    loan = round(price * ltv / 1000) * 1000
    dbr = round(random.uniform(0.25, 0.44), 2)
    return {
        "client_name": random_name(),
        "segment": segment,
        "residency": residency,
        "purpose": purpose,
        "property_type": ptype,
        "property_price": price,
        "loan_amount": loan,
        "ltv": ltv,
        "dbr": dbr,
        "assigned_rm": random.choice(RMS),
        "source_channel": random.choice(SOURCE_CHANNELS),
    }


def build_case(
    demo,
    stage,
    dwell,
    activities,
    valuation_status=None,
    val_requested_days=None,
    docs_outstanding=None,
    services=None,
    milestones=None,
    handover_days=None,
    transfer_type=None,
    pre_approval_days=None,
    force_switch=False,
    dbr_override=None,
) -> dict:
    """Assemble one full case dict (id assigned later)."""
    segment = demo["segment"]
    dbr = dbr_override if dbr_override is not None else demo["dbr"]
    ptype = demo["property_type"]
    price = demo["property_price"]
    loan = demo["loan_amount"]
    source = demo["source_channel"]
    sidx = STAGE_INDEX[stage]

    history = make_stage_history(stage, dwell)
    banks = make_bank_options(segment, dbr, force_switch)
    selected = next(b for b in banks if b["selected"])
    expected_commission = round(loan * selected["commission_pct"])

    # pre-approval date
    if sidx >= PRE_APPROVAL_IDX:
        pad = pre_approval_days if pre_approval_days is not None else random.randint(3, 40)
        pre_approval_date = days_before(pad)
    else:
        pre_approval_date = None

    # valuation status / requested date
    if valuation_status is None:
        if sidx < VALUATION_IDX:
            v_status, v_date = "not_requested", None
        elif sidx == VALUATION_IDX:
            v_status, v_date = "requested", days_before(random.randint(1, 3))
        else:
            v_status, v_date = "completed", days_before(random.randint(20, 60))
    else:
        v_status = valuation_status
        if v_status == "requested":
            vd = val_requested_days if val_requested_days is not None else random.randint(1, 3)
            v_date = days_before(vd)
        elif v_status == "completed":
            vd = val_requested_days if val_requested_days is not None else random.randint(20, 60)
            v_date = days_before(vd)
        else:
            v_date = None

    docs = docs_outstanding if docs_outstanding is not None else random.choice([0, 0, 1])
    svcs = services if services is not None else default_services(sidx, source)

    if ptype == "offplan":
        handover = days_after(handover_days) if handover_days is not None else days_after(
            random.randint(200, 1100)
        )
        ms = milestones if milestones is not None else default_milestones(price)
    else:
        handover, ms = None, None

    if sidx >= SIGNED_IDX:
        tt = transfer_type if transfer_type is not None else random.choice(["one_bank", "two_bank"])
    else:
        tt = None

    return {
        "client_name": demo["client_name"],
        "segment": segment,
        "residency": demo["residency"],
        "purpose": demo["purpose"],
        "property_type": ptype,
        "property_price": price,
        "loan_amount": loan,
        "ltv": demo["ltv"],
        "stage": stage,
        "dbr": dbr,
        "bank_options": banks,
        "expected_commission": expected_commission,
        "valuation_status": v_status,
        "valuation_requested_date": v_date,
        "stage_history": history,
        "assigned_rm": demo["assigned_rm"],
        "source_channel": source,
        "pre_approval_date": pre_approval_date,
        "payment_milestones": ms,
        "handover_date": handover,
        "activities": sorted(activities, key=lambda a: a["date"]),
        "docs_outstanding": docs,
        "services_attached": svcs,
        "transfer_type": tt,
    }


def healthy_acts(dwell: int) -> list:
    """Recent, two-way engagement: last inbound within ~6 days, so healthy cases
    never trip GONE_QUIET / PAYMENT_CLIFF and their short dwell stays under p75."""
    base = dwell + random.randint(5, 20)
    mid = random.randint(10, 22)
    last_in = random.randint(2, 6)
    return [
        A(base, "outbound", "call", "intro_call"),
        A(base - random.randint(1, 3), "inbound", "whatsapp", "reply"),
        A(mid, "outbound", "email", "doc_request"),
        A(mid - random.randint(1, 4), "inbound", "whatsapp", "doc_upload"),
        A(last_in + random.randint(0, 2), "outbound", "whatsapp", "follow_up"),
        A(last_in, "inbound", "whatsapp", "status_query"),
    ]


# --------------------------------------------------------------------------- #
# Case generation
# --------------------------------------------------------------------------- #

def generate() -> list:
    records = []  # list of (case, pattern_label)

    # -- P1: cost-shock stall after valuation (25) -------------------------- #
    # Split so the book shows both classifier classes cleanly:
    #   15 STALLED (recent inbound, recoverable) + 10 RATIONAL_PAUSE (gone silent).
    for i in range(15):
        stage = "valuation" if i < 8 else "final_offer"
        demo = base_demo()
        dwell = random.randint(19, 27)
        # Client last replied 11-13d ago (>10d) then went silent under 3 chases:
        # GONE_QUIET fires regardless of the p75 benchmark, and inbound is still
        # inside 14d so the classifier lands on STALLED (recoverable).
        last_in = random.randint(11, 13)
        acts = [
            A(dwell + random.randint(4, 12), "outbound", "call", "valuation_review"),
            A(dwell + random.randint(1, 3), "inbound", "whatsapp", "cost_concern"),
            A(last_in, "inbound", "whatsapp", "reply"),
            A(random.randint(6, 8), "outbound", "whatsapp", "follow_up"),
            A(random.randint(3, 5), "outbound", "call", "follow_up"),
            A(random.randint(1, 2), "outbound", "whatsapp", "follow_up"),
        ]
        records.append(
            (build_case(demo, stage, dwell, acts, valuation_status="completed"),
             "P1_post_valuation_quiet")
        )
    for i in range(10):
        stage = "valuation" if i < 5 else "final_offer"
        demo = base_demo()
        demo["purpose"] = "end_use" if i % 2 == 0 else "investment"
        dwell = random.randint(26, 42)
        last_in = dwell + random.randint(20, 35)  # inbound predates valuation entry
        acts = [
            A(last_in + random.randint(2, 6), "outbound", "call", "doc_request"),
            A(last_in, "inbound", "whatsapp", "doc_upload"),
            A(dwell - random.randint(0, 3), "outbound", "call", "valuation_result"),
            A(random.randint(8, 16), "outbound", "whatsapp", "nudge"),
            A(random.randint(2, 6), "outbound", "whatsapp", "nudge"),
        ]
        # A final_offer rational-pause case with conveyancing missing demonstrates
        # cross-sell suppression ("held: client is re-evaluating").
        svcs = [] if stage == "final_offer" else None
        records.append(
            (build_case(demo, stage, dwell, acts, valuation_status="completed", services=svcs),
             "P1_post_valuation_quiet")
        )

    # -- P2: offplan payment cliff, client silent (15) ---------------------- #
    for _ in range(15):
        demo = base_demo(force_offplan=True)
        stage = random.choice(["property_found", "application", "valuation", "final_offer"])
        dwell = random.randint(6, 16)
        last_in = random.randint(11, 13)  # >10d (flag) but <14d (STALLED)
        ms = [
            {
                "due_date": days_after(random.randint(6, 28)),
                "amount": round(demo["property_price"] * random.uniform(0.05, 0.12) / 1000) * 1000,
            },
            {
                "due_date": days_after(random.randint(120, 360)),
                "amount": round(demo["property_price"] * random.uniform(0.05, 0.10) / 1000) * 1000,
            },
        ]
        acts = [
            A(last_in + random.randint(6, 15), "outbound", "call", "intro_call"),
            A(last_in, "inbound", "whatsapp", "reply"),
            A(random.randint(2, 6), "outbound", "whatsapp", "payment_reminder"),
            A(random.randint(2, 6), "outbound", "call", "payment_reminder"),
        ]
        records.append(
            (build_case(demo, stage, dwell, acts, milestones=sorted(ms, key=lambda m: m["due_date"])),
             "P2_payment_cliff")
        )

    # -- P3: signed/disbursed with mandatory life insurance missing (20) ---- #
    for i in range(20):
        stage = "signed" if i < 12 else "disbursed"
        demo = base_demo()
        dwell = random.randint(3, 9)
        svcs = ["conveyancing"] + (["home_insurance"] if random.random() < 0.4 else [])
        records.append(
            (build_case(demo, stage, dwell, healthy_acts(dwell), services=svcs,
                        transfer_type=random.choice(["one_bank", "two_bank"])),
             "P3_life_insurance_gap")
        )

    # -- P4: pre-approval expiring, still at property_found (10) ------------- #
    for _ in range(10):
        demo = base_demo()
        dwell = random.randint(5, 13)
        k = random.randint(2, 13)  # days until expiry, within 14
        last_in = random.randint(3, 12)
        acts = [
            A(last_in + random.randint(5, 15), "outbound", "call", "pre_approval_issued"),
            A(last_in, "inbound", "whatsapp", "property_shortlist"),
            A(random.randint(1, 4), "outbound", "whatsapp", "expiry_reminder"),
        ]
        records.append(
            (build_case(demo, "property_found", dwell, acts, pre_approval_days=60 - k),
             "P4_pre_approval_expiry")
        )

    # -- P5: two-bank transfer tunnel, silent (12) -------------------------- #
    for _ in range(12):
        demo = base_demo()
        dwell = random.randint(46, 70)
        last_in = random.randint(20, 35)  # inbound after valuation, none in last 14d
        acts = [
            A(last_in + random.randint(10, 25), "inbound", "whatsapp", "signed_docs"),
            A(last_in, "inbound", "email", "transfer_query"),
            A(random.randint(3, 12), "outbound", "whatsapp", "status_update"),
            A(random.randint(3, 12), "outbound", "call", "status_update"),
        ]
        svcs = ["conveyancing", "life_insurance"] + (["home_insurance"] if random.random() < 0.5 else [])
        records.append(
            (build_case(demo, "signed", dwell, acts, transfer_type="two_bank", services=svcs),
             "P5_transfer_tunnel")
        )

    # -- P6: offplan handover pipeline, no mortgage progressing (8) --------- #
    for _ in range(8):
        demo = base_demo(force_offplan=True)
        stage = random.choice(["lead", "pre_approval", "property_found"])
        dwell = random.randint(3, 9)
        records.append(
            (build_case(demo, stage, dwell, healthy_acts(dwell),
                        handover_days=random.randint(60, 175)),
             "P6_handover_pipeline")
        )

    # -- P7: valuation requested, past 5-working-day SLA (15) --------------- #
    for _ in range(15):
        demo = base_demo()
        dwell = random.randint(9, 18)
        last_in = random.randint(4, 12)
        acts = [
            A(last_in + random.randint(6, 15), "outbound", "call", "valuation_requested"),
            A(last_in, "inbound", "whatsapp", "reply"),
            A(random.randint(1, 5), "outbound", "email", "chase_valuer"),
        ]
        records.append(
            (build_case(demo, "valuation", dwell, acts, valuation_status="requested",
                        val_requested_days=random.randint(9, 16)),
             "P7_valuation_overdue")
        )

    # -- P8: docs outstanding, no doc activity in 5+ days (10) -------------- #
    for i in range(10):
        demo = base_demo()
        stage = "application" if i < 6 else "valuation"
        dwell = random.randint(7, 16)
        doc_gap = random.randint(6, 12)  # last doc touch > 5 days ago
        last_in = random.randint(6, 12)
        acts = [
            A(doc_gap + random.randint(3, 8), "outbound", "email", "doc_request"),
            A(doc_gap, "outbound", "whatsapp", "doc_chase"),
            A(last_in, "inbound", "whatsapp", "question"),
        ]
        records.append(
            (build_case(demo, stage, dwell, acts, docs_outstanding=random.randint(2, 4)),
             "P8_docs_stuck")
        )

    # -- P9: DBR exceeds selected bank, fits another (8) -------------------- #
    for _ in range(8):
        demo = base_demo()
        stage = random.choice(["property_found", "application", "valuation"])
        dwell = random.randint(3, 9)
        records.append(
            (build_case(demo, stage, dwell, healthy_acts(dwell), force_switch=True,
                        dbr_override=round(random.uniform(0.46, 0.49), 2)),
             "P9_dbr_switch")
        )

    # -- Healthy remainder --------------------------------------------------- #
    planted = len(records)
    for _ in range(400 - planted):
        demo = base_demo()
        stage = random.choice(HEALTHY_STAGE_POOL)
        dwell = random.randint(3, 11)
        records.append((build_case(demo, stage, dwell, healthy_acts(dwell)), "healthy"))

    # Shuffle and assign stable ids.
    random.shuffle(records)
    for idx, (case, _label) in enumerate(records, start=1):
        case["id"] = f"HOL-{idx:04d}"

    # Reassign client names last, with a dedicated RNG that does NOT touch the
    # stream above (so every other field is unchanged), enforcing no duplicate
    # first/last name within any RM's top-10 action queue.
    assign_client_names([c for c, _ in records])
    return records


# --------------------------------------------------------------------------- #
# Detectors (mirror lib/engine.ts rules) — used only to verify the book
# --------------------------------------------------------------------------- #

def d(dstr):
    return date.fromisoformat(dstr)


def days_ago(dstr):
    return (NOW - d(dstr)).days


def cur_dwell(case):
    return days_ago(case["stage_history"][-1]["entered_at"])


def last_inbound(case):
    ins = [days_ago(a["date"]) for a in case["activities"] if a["direction"] == "inbound"]
    return min(ins) if ins else None


def count_dir_last(case, direction, n):
    return sum(
        1 for a in case["activities"]
        if a["direction"] == direction and days_ago(a["date"]) <= n
    )


def no_inbound_in(case, n):
    li = last_inbound(case)
    return li is None or li > n


def working_days_since(dstr):
    cur, count = d(dstr), 0
    while cur < NOW:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return count


def percentile75(values):
    if not values:
        return float("inf")
    s = sorted(values)
    k = max(0, min(math.ceil(0.75 * len(s)) - 1, len(s) - 1))
    return s[k]


def p75_by_stage(cases):
    buckets = {}
    for c in cases:
        buckets.setdefault(c["stage"], []).append(cur_dwell(c))
    return {stage: percentile75(v) for stage, v in buckets.items()}


def risk_flags(case, p75map):
    flags = set()
    sidx = STAGE_INDEX[case["stage"]]

    # Never on 'disbursed': a funded, closed case cannot "stall". Mirrors engine.ts.
    if case["stage"] != "disbursed" and cur_dwell(case) > p75map.get(case["stage"], float("inf")):
        flags.add("VELOCITY_STALL")

    if case["property_type"] == "offplan" and case["payment_milestones"]:
        for m in case["payment_milestones"]:
            due = (d(m["due_date"]) - NOW).days
            if 0 <= due <= 30 and no_inbound_in(case, 10):
                flags.add("PAYMENT_CLIFF")
                break

    if case["pre_approval_date"] and sidx < FINAL_OFFER_IDX:
        expiry = d(case["pre_approval_date"]) + timedelta(days=60)
        if 0 <= (expiry - NOW).days <= 14:
            flags.add("PRE_APPROVAL_EXPIRY")

    if (
        case["transfer_type"] == "two_bank"
        and case["stage"] == "signed"
        and cur_dwell(case) >= 45
        and no_inbound_in(case, 14)
    ):
        flags.add("TRANSFER_TUNNEL")

    if count_dir_last(case, "outbound", 10) >= 3 and count_dir_last(case, "inbound", 10) == 0:
        flags.add("GONE_QUIET")

    if case["valuation_status"] == "requested" and case["valuation_requested_date"]:
        if working_days_since(case["valuation_requested_date"]) > 5:
            flags.add("VALUATION_OVERDUE")

    if case["docs_outstanding"] >= 2 and case["stage"] in ("application", "valuation"):
        doc_touches = [days_ago(a["date"]) for a in case["activities"] if "doc" in a["type"]]
        if not doc_touches or min(doc_touches) > 5:
            flags.add("DOCS_STUCK")

    return flags


def cross_sell(case):
    triggers = set()
    sidx = STAGE_INDEX[case["stage"]]
    # Excludes 'disbursed': conveyancing is a pre-closing service (mirrors engine.ts).
    if (sidx >= FINAL_OFFER_IDX and case["stage"] != "disbursed"
            and "conveyancing" not in case["services_attached"] and cur_dwell(case) >= 5):
        triggers.add("CONVEYANCING_ATTACH")
    if sidx >= SIGNED_IDX and "life_insurance" not in case["services_attached"]:
        triggers.add("LIFE_INSURANCE_GAP")
    if case["property_type"] == "offplan" and case["handover_date"]:
        if 0 <= (d(case["handover_date"]) - NOW).days <= 180:
            triggers.add("HANDOVER_PIPELINE")
    return triggers


def dbr_switch(case):
    selected = next(b for b in case["bank_options"] if b["selected"])
    if case["dbr"] > selected["dbr_limit"]:
        return any(
            (not b["selected"]) and b["dbr_limit"] >= case["dbr"]
            for b in case["bank_options"]
        )
    return False


# Mirrors STALL_FLAG_CODES in lib/engine.ts. Only "stall detection" flags can
# make a case STALLED or RATIONAL_PAUSE; the early-warning flags (pre-approval
# expiry, payment cliff, valuation SLA) are time-bound alerts, not stalls.
STALL_FLAGS = {"VELOCITY_STALL", "TRANSFER_TUNNEL", "GONE_QUIET", "DOCS_STUCK"}


def classify(case, p75map):
    """Label only. lib/engine.ts additionally returns the pause kind + action."""
    flags = risk_flags(case, p75map)
    if not (flags & STALL_FLAGS):
        return "HEALTHY"
    li = last_inbound(case)
    if li is not None and li <= 14:
        return "STALLED"
    if cur_dwell(case) > 21:
        return "RATIONAL_PAUSE"
    return "HEALTHY"


def pause_kind(case, p75map):
    """'process_blocked' (chase the pipeline) vs 'customer_paused' (nurture)."""
    if classify(case, p75map) != "RATIONAL_PAUSE":
        return None
    if "TRANSFER_TUNNEL" in risk_flags(case, p75map):
        return "process_blocked"
    return "customer_paused"


def detect_p1(case, p75map):
    """P1 = a genuinely-flagged stall sitting at a completed valuation (the
    cost-shock pattern), whether the signal is velocity or a silent client."""
    return (
        case["stage"] in ("valuation", "final_offer")
        and case["valuation_status"] == "completed"
        and len(risk_flags(case, p75map)) > 0
    )


# --------------------------------------------------------------------------- #
# Client-name assignment (mirrors the app's action-queue ranking)
# --------------------------------------------------------------------------- #

# stage_probability from CLAUDE.md; disbursed (funded) = 1.0. Matches lib/engine.ts.
STAGE_PROB = {
    "lead": 0.15, "pre_approval": 0.35, "property_found": 0.50, "application": 0.55,
    "valuation": 0.65, "final_offer": 0.85, "signed": 0.95, "disbursed": 1.0,
}


def _priority(case):
    """Same score the UI ranks the action queue by: commission x stage x freshness."""
    days = min((days_ago(a["date"]) for a in case["activities"]), default=None)
    if days is None:
        decay = 0.2
    elif days < 7:
        decay = 1.0
    elif days < 14:
        decay = 0.7
    elif days < 30:
        decay = 0.4
    else:
        decay = 0.2
    return case["expected_commission"] * STAGE_PROB[case["stage"]] * decay


def rm_top10(cases, p75map):
    """Each RM's top-10 action queue: cases carrying a flag or cross-sell, ranked
    by priority (stable) — exactly what Screen 1 shows."""
    by_rm = {}
    for c in cases:
        by_rm.setdefault(c["assigned_rm"], []).append(c)
    out = {}
    for rm, cs in by_rm.items():
        flagged = [c for c in cs if risk_flags(c, p75map) or cross_sell(c)]
        flagged.sort(key=_priority, reverse=True)
        out[rm] = flagged[:10]
    return out


def assign_client_names(cases, seed=20260720):
    """Reassign every client_name in place. Guarantees that within each RM's
    top-10 action queue no first name and no last name repeats. Uses a dedicated
    RNG so it never perturbs the main generation stream."""
    rng = random.Random(seed)
    p75map = p75_by_stage(cases)
    queues = rm_top10(cases, p75map)

    names = {}
    for rm in sorted(queues):
        group = queues[rm]
        firsts = rng.sample(FIRST_NAMES, len(group))
        lasts = rng.sample(LAST_NAMES, len(group))
        for case, f, l in zip(group, firsts, lasts):
            names[case["id"]] = (f, l)

    for c in sorted(cases, key=lambda c: c["id"]):
        if c["id"] not in names:
            names[c["id"]] = (rng.choice(FIRST_NAMES), rng.choice(LAST_NAMES))

    for c in cases:
        f, l = names[c["id"]]
        c["client_name"] = f"{f} {l}"


# --------------------------------------------------------------------------- #
# Summary
# --------------------------------------------------------------------------- #

def print_summary(records):
    cases = [c for c, _ in records]
    p75map = p75_by_stage(cases)

    print("=" * 68)
    print(f"  HOME case-book generated   seed={SEED}   anchor={REFERENCE_DATE}")
    print("=" * 68)
    print(f"  Total cases: {len(cases)}\n")

    print("  Cases per stage")
    print("  " + "-" * 40)
    for s in STAGES:
        n = sum(1 for c in cases if c["stage"] == s)
        bar = "#" * n
        print(f"  {s:<16} {n:>3}  {bar}")
    print()

    seg = {}
    for c in cases:
        seg[c["segment"]] = seg.get(c["segment"], 0) + 1
    pt = {}
    for c in cases:
        pt[c["property_type"]] = pt.get(c["property_type"], 0) + 1
    print(f"  Segment:        {dict(sorted(seg.items()))}")
    print(f"  Property type:  {dict(sorted(pt.items()))}\n")

    print("  p75 stage-dwell benchmark (days) - feeds VELOCITY_STALL")
    print("  " + "-" * 40)
    for s in STAGES:
        if s in p75map:
            print(f"  {s:<16} {p75map[s]:>3}")
    print()

    # Planted patterns: intended vs. re-detected from the data.
    detectors = {
        "P1_post_valuation_quiet": lambda c: detect_p1(c, p75map),
        "P2_payment_cliff": lambda c: "PAYMENT_CLIFF" in risk_flags(c, p75map),
        "P3_life_insurance_gap": lambda c: "LIFE_INSURANCE_GAP" in cross_sell(c),
        "P4_pre_approval_expiry": lambda c: "PRE_APPROVAL_EXPIRY" in risk_flags(c, p75map),
        "P5_transfer_tunnel": lambda c: "TRANSFER_TUNNEL" in risk_flags(c, p75map),
        "P6_handover_pipeline": lambda c: "HANDOVER_PIPELINE" in cross_sell(c),
        "P7_valuation_overdue": lambda c: "VALUATION_OVERDUE" in risk_flags(c, p75map),
        "P8_docs_stuck": lambda c: "DOCS_STUCK" in risk_flags(c, p75map),
        "P9_dbr_switch": dbr_switch,
    }
    print("  Planted leakage patterns (intended vs. detected from data)")
    print("  " + "-" * 58)
    print(f"  {'pattern':<28}{'target':>8}{'detected':>10}   ok")
    print("  " + "-" * 58)
    all_ok = True
    for key, target in PATTERN_TARGETS.items():
        detected = sum(1 for c in cases if detectors[key](c))
        ok = detected >= target
        all_ok = all_ok and ok
        print(f"  {key:<28}{target:>8}{detected:>10}   {'OK' if ok else 'LOW'}")
    print("  " + "-" * 58)
    print(f"  every planted pattern present at target: {'YES' if all_ok else 'NO'}\n")

    # Full flag / trigger / classifier distribution (cross-check).
    flag_counts, trig_counts, cls_counts = {}, {}, {}
    for c in cases:
        for f in risk_flags(c, p75map):
            flag_counts[f] = flag_counts.get(f, 0) + 1
        for t in cross_sell(c):
            trig_counts[t] = trig_counts.get(t, 0) + 1
        cls = classify(c, p75map)
        cls_counts[cls] = cls_counts.get(cls, 0) + 1

    print("  Risk-flag distribution (a case may carry several)")
    print("  " + "-" * 40)
    for f in sorted(flag_counts):
        print(f"  {f:<22} {flag_counts[f]:>3}")
    print()
    print("  Cross-sell trigger distribution")
    print("  " + "-" * 40)
    for t in sorted(trig_counts):
        print(f"  {t:<22} {trig_counts[t]:>3}")
    print()
    print("  Classifier distribution")
    print("  " + "-" * 40)
    for cls in ("STALLED", "RATIONAL_PAUSE", "HEALTHY"):
        print(f"  {cls:<22} {cls_counts.get(cls, 0):>3}")
    print()


def main():
    records = generate()
    cases = [c for c, _ in records]

    out_path = Path(__file__).resolve().parent.parent / "data" / "cases.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(cases, indent=2), encoding="utf-8")

    print_summary(records)
    size_kb = out_path.stat().st_size / 1024
    print(f"  Wrote {len(cases)} cases -> {out_path}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
