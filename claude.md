# HOME Intelligence Layer, Prototype Build Spec
Working prototype for Holo Principal PM submission. Built with Claude Code, deployed on Vercel.

> **Note:** This is the *original* build spec. The shipped engine deviates from it in a
> handful of deliberate, eval-driven ways (classifier gating, the customer-paused vs
> process-blocked split, terminal-stage flag exclusions, seven risk flags not five). Those
> changes are intentional and are the correct behaviour — see **README → "Deviations from
> the spec (and why)"** for the full list and rationale. The spec is kept as-written to show
> the plan the evidence then improved on.

---

## PART A: WORKFLOW

### What this is
A two-screen web app that answers three questions over a synthetic book of 400 mortgage cases:
1. Which cases are at risk, and is each one "stalled" (recoverable) or a "rational pause" (route to nurture)?
2. What is the next best action for each case manager today, ranked by AED at stake?
3. Which cross-sell triggers should fire right now, and why?

Everything is explainable. No black box. Rules first, models later.

### Scope framing (state this in README and memo)
- **Funnel scope:** mid-to-end only. Mid = pre_approval through final_offer (deciding, valuation, underwriting). End = signed through disbursed plus service attachment. The `lead` stage exists for funnel shape; the engine's interventions start at pre_approval. Acquisition and onboarding are explicitly out of scope (Holo's prior-year focus).
- **Entity scope:** anchored on Holo Mortgage UAE as the system of record. Concierge is modeled as a source channel and an attachable service, not a separate funnel. KSA is addressed as architecture, not build: the engine is a parameterized rule table, so market differences (DBR caps, valuation SLAs, commission structures, subsidized-rate programs) are per-market config on the same rules, and stage benchmarks self-calibrate from each market's own book.
- **Segment scope:** residential only; commercial property finance is a different funnel (different lenders, corporate borrowers, KYB, LTV regime) and is explicitly out of scope. Inside residential, segmentation is baked into the rules rather than added as filters: ready vs off-plan determines which risk flags can fire (payment cliffs and handover pipeline are off-plan only; transfer tunnel and valuation SLA are ready/secondary), borrower profile (salaried/self-employed, resident/non-resident) feeds bank fit and approval assumptions, and buyer purpose feeds re-engagement messaging.

### Pipeline (all offline, runs at build time)
```
generate_cases.py          -> data/cases.json          (synthetic book of 400 cases)
scoring_engine (TS lib)    -> computed per case at build (priority, risk, classification, triggers)
run_evals.py               -> data/eval_results.json   (classifier metrics + LLM brief checks)
generate_ai_briefs.py      -> data/ai_briefs.json      (Claude API, run locally once, outputs committed)
Next.js app                -> reads the JSON files, renders 2 screens
Vercel                     -> public link, no API keys in the deployed app
```
Hard rules: no auth, no database, no live LLM calls, no CRUD, no mobile optimization.

### Data schema (cases.json)
Each case object:
- `id`, `client_name` (fake), `segment` (salaried | self_employed), `residency` (resident | non_resident), `purpose` (end_use | investment; changes nurture messaging for RATIONAL_PAUSE cases: end-users get rent-vs-buy framing, investors get yield/rate-watch framing)
- `property_type` (ready | offplan), `property_price` (AED 800K to 2.5M), `loan_amount`, `ltv` (0.75 to 0.80)
- `stage` (lead | pre_approval | property_found | application | valuation | final_offer | signed | disbursed)
- `dbr` (debt burden ratio at submission, 0.25 to 0.52; UAE regulatory cap 0.50)
- `bank_options`: array of 2 or 3 candidate banks, each `{bank_name, rate, commission_pct (0.005 to 0.012), payout_event (approval | disbursal), approval_probability (STATIC assumption by segment, clearly labeled as assumption), avg_days_to_fund, dbr_limit}`. Exactly one marked `selected: true`
- `valuation_status` (not_requested | requested | completed | issue) and `valuation_requested_date` (SLA benchmark: 5 working days)
- `stage_history`: array of `{stage, entered_at}` timestamps
- `assigned_rm` (6 fake RMs), `source_channel` (organic | agent_referral | concierge | paid)
- `expected_commission` = loan_amount x selected bank's commission_pct (no more flat 1%)
- `pre_approval_date` (for expiry math, valid 60 days)
- `payment_milestones` (offplan only): array of `{due_date, amount}`
- `handover_date` (offplan only)
- `activities`: array of `{date, direction: outbound | inbound, channel: whatsapp | email | call, type}`
- `docs_outstanding`: int
- `services_attached`: subset of [conveyancing, life_insurance, home_insurance, concierge]
- `transfer_type` (one_bank | two_bank), set when stage >= signed

### Baked-in leakage patterns (the generator must plant these deliberately)
1. ~25 cases quiet 3+ days immediately after valuation stage (cost-shock stall pattern)
2. ~15 offplan cases with a payment milestone due within 30 days and no recent contact
3. ~20 signed/disbursed cases with life_insurance NOT attached (mandatory product, pure leakage)
4. ~10 cases with pre_approval expiring within 14 days and stage still property_found
5. ~12 two_bank cases sitting in the post-signed transfer tunnel 45+ days with no inbound activity
6. ~8 offplan cases anywhere in book with handover_date within 6 months (pre-arrangement pipeline)
7. ~15 cases with valuation requested 6 to 12 working days ago and still not completed (SLA breach)
8. ~10 cases at application/valuation with 2+ docs outstanding and no doc activity in 5+ days
9. ~8 cases where dbr exceeds the selected bank's limit but fits another candidate bank (switch opportunity)
The rest of the book is healthy with realistic stage distribution and decay.

### Rules engine (pure functions, unit tested)

**Priority score** = expected_commission x stage_probability x staleness_decay
- stage_probability: lead 0.15, pre_approval 0.35, property_found 0.50, application 0.55, valuation 0.65, final_offer 0.85, signed 0.95
- staleness_decay: 1.0 if last activity < 7 days, 0.7 if < 14, 0.4 if < 30, 0.2 otherwise

**Risk flags** (a case can carry multiple). Code names are internal; the UI must ONLY show the display label plus a specific reason sentence with real numbers (e.g. "Stuck at valuation 14 days, typical is 9"). Never show code names, percentiles, or jargon on screen.
| Code name | UI display label | Rule |
|---|---|---|
| VELOCITY_STALL | Stuck longer than normal | dwell time in current stage > p75 benchmark for that stage (compute benchmarks from the book itself) |
| PAYMENT_CLIFF | Big payment due, client silent | offplan milestone due within 30 days AND no inbound activity in last 10 days |
| PRE_APPROVAL_EXPIRY | Pre-approval expiring soon | pre_approval_date + 60 days is within 14 days AND stage < final_offer |
| TRANSFER_TUNNEL | Quiet during transfer wait | two_bank, stage = signed, 45+ days since stage entry, no inbound in 14 days |
| GONE_QUIET | Not responding to outreach | 3+ outbound with zero inbound over last 10 days |
| VALUATION_OVERDUE | Valuation taking too long | valuation_status = requested AND aging > 5 working days |
| DOCS_STUCK | Documents holding this up | docs_outstanding >= 2 AND stage in (application, valuation) AND no doc-related activity in 5+ days |

**Stall vs rational-exit classifier** (only for flagged cases):
- STALLED: flagged AND at least one inbound activity in last 14 days (still engaged, recoverable, action = call/nudge)
- RATIONAL_PAUSE: flagged AND zero inbound since the stage where costs were disclosed (valuation or later) AND dwell > 21 days (action = move to rate-watch nurture, stop active RM time)
- else HEALTHY
- **Suppression rule:** for RATIONAL_PAUSE cases, all cross-sell triggers and active-outreach recommendations are suppressed; the only permitted output is the nurture-track assignment (end_use → rent-vs-buy framing, investment → rate/yield-watch framing). The UI shows suppressed triggers greyed with the note "held: client is re-evaluating". This is the "without adding friction" mechanism and must be visibly demonstrated on at least one case.

**Cross-sell triggers:**
| Trigger | Rule | Framing |
|---|---|---|
| CONVEYANCING_ATTACH | stage >= final_offer AND conveyancing not attached AND 5+ days in stage | "already inside your closing costs" |
| LIFE_INSURANCE_GAP | stage >= signed AND life_insurance not attached | compliance-flavored, mandatory with UAE mortgages |
| HANDOVER_PIPELINE | offplan AND handover_date within 180 days AND no mortgage case open for it | scheduled pre-arrangement outreach |

**Bank selection intelligence** (computed per case, shown in the case expand panel):
- Expected funded revenue per candidate bank = loan_amount x commission_pct x approval_probability
- Recommend a switch ONLY when the revenue-optimal bank's customer rate is within 0.10% of the currently selected bank (fairness guardrail; the UI states this guardrail explicitly)
- DBR conflict check: if case dbr > selected bank's dbr_limit but fits another candidate's limit, surface "DBR X% exceeds [Bank A] limit Y%, fits [Bank B], suggest switch before submission"
- Payout-event note: banks paying at disbursal carry longer revenue-at-risk windows than banks paying at approval; show this in the comparison
- approval_probability values are static per-segment assumptions and the UI labels them "assumption", never "prediction"

### Eval harness
1. **Classifier eval:** hand-label 30 cases (goldens.json) as STALLED / RATIONAL_PAUSE / HEALTHY. Run classifier, output precision + recall per class and a 3x3 confusion matrix into eval_results.json. Render on the Leadership screen.
2. **LLM brief eval:** for each AI brief, programmatic checks: (a) every number in the brief exists in the case record, (b) recommended action matches the rules engine output, (c) no client details not present in the data. Output pass rate.

### AI generation (build-time only)
For the top 20 priority flagged cases, call Claude API locally to generate:
- a 3-sentence "AI case brief" (situation, risk, why it matters in AED)
- a WhatsApp-style intervention draft the RM could edit and send (GCC tone, short, warm, specific)
Store in ai_briefs.json, committed to repo. The deployed app never calls any API.

### Screens
**Screen 1, Case Manager view ("Today"):** RM selector; ranked action queue (top 10); each row = client, AED at stake, flag chips, STALLED vs RATIONAL_PAUSE badge, plain-English reason; expand row = full score breakdown, bank comparison card (candidate banks with expected revenue, days-to-fund, DBR fit, and the system recommendation with the fairness guardrail stated), AI brief, WhatsApp draft with copy button.
**Screen 2, Leadership view:** headline banner "AED X.XM commission at risk across N cases" with breakdown by reason (valuation delay, docs stuck, client silent, pre-approval expiry, transfer tunnel); revenue at risk by stage (AED bar), funnel leakage waterfall, cross-sell attachment rate by service, handover-pipeline card with total future commission value, bank performance snapshot table (per bank: in-funnel cases, avg days-to-fund, commission per AED funded), eval results panel (confusion matrix + brief pass rate), "recovered this month" placeholder metric.
**Screen 3, Rules page (/rules), read-only:** every active rule rendered as a plain condition → action block. Group risk flags into "Early warnings (fire before anything goes wrong)": pre-approval expiry, payment cliff, handover pipeline, valuation SLA countdown; and "Stall detection (something already slowed)": stuck longer than normal, quiet in transfer wait, not responding, docs stuck. Then cross-sell triggers (with the rational-pause suppression rule shown), bank selection logic, and the classifier. No editing, no interactivity. Purpose: show the whole engine is a legible rule table anyone at Holo could challenge, and that a rule-builder UI is the obvious Phase 2.

Design: clean internal-tool aesthetic, light theme, one accent color, dense tables over cards, AED formatted with thousands separators. No dashboard bling.

---

## PART B: STEP-BY-STEP CLAUDE CODE PROMPTS

### Step 0: Setup
Create an empty folder, run `claude` in it. First save THIS ENTIRE FILE as `CLAUDE.md` in the repo root so every prompt has full context. Then run the prompts below one at a time. Review output after each step before moving on.

### Prompt 1, scaffold
```
Read CLAUDE.md fully. Scaffold a Next.js 14 app (app router) with TypeScript and Tailwind.
Structure: /app (two routes: / for Case Manager view, /leadership), /lib (scoring engine),
/scripts (Python: generate_cases.py, run_evals.py, generate_ai_briefs.py), /data (JSON outputs).
Add npm scripts. Do not build any UI yet. Confirm the structure back to me.
```

### Prompt 2, data generator
```
Implement scripts/generate_cases.py exactly per the schema and the six baked-in leakage
patterns in CLAUDE.md. 400 cases, seeded RNG for reproducibility, realistic UAE names
(clearly fictional), dates spread over the last 8 months, stage_history consistent with
current stage. Output data/cases.json. Then print a summary table: cases per stage,
count of each planted leakage pattern, so I can verify the patterns exist.
```
Verify the summary matches the spec before continuing.

### Prompt 3, rules engine
```
Implement /lib/engine.ts per the CLAUDE.md rules: priority score, the seven risk flags,
the stall vs rational-pause classifier, and the three cross-sell triggers. Pure functions,
no React. Stage dwell benchmarks (p75) computed from the dataset itself. Every output must
include a humanReadableReason string explaining the exact rule that fired with the numbers.
Write unit tests (vitest) covering each flag, each trigger, and both classifier classes
with hand-built fixture cases. Run the tests and show me results.
```

### Prompt 4, eval harness
```
1) Create data/goldens.json: select 30 diverse cases from cases.json (mix of planted
patterns and healthy) and output them with an empty "label" field for me to fill by hand.
STOP after generating it.
```
Hand-label the 30 cases yourself (this matters, it is your judgment being encoded). Then:
```
2) Implement scripts/run_evals.py: load goldens.json with my labels, run the classifier,
output precision and recall per class and a 3x3 confusion matrix to data/eval_results.json.
Also implement the LLM brief checks from CLAUDE.md as functions ready to run once briefs exist.
Run it and show me the confusion matrix.
```
If precision/recall is poor, tune thresholds with Claude Code and re-run. Iterating here IS the story you tell in the interview.

### Prompt 5, AI briefs (run locally, needs ANTHROPIC_API_KEY in .env, never deployed)
```
Implement scripts/generate_ai_briefs.py: take the top 20 flagged cases by priority score,
call the Anthropic API (model claude-sonnet-4-6) once per case with the case record and the
engine's reason string. Generate per CLAUDE.md: 3-sentence brief + WhatsApp intervention
draft (under 60 words, warm, specific, no pressure tactics, references their actual
situation). Output data/ai_briefs.json. Then run the LLM brief eval from run_evals.py
against these outputs and append the pass rate to eval_results.json. Add .env to .gitignore.
```
Read all 20 drafts yourself. Delete or regenerate any that feel off. You are the quality gate.

### Prompt 6, Case Manager screen
```
Build the Case Manager view per CLAUDE.md Screen 1. Load the three JSON files statically
at build time. RM selector at top, ranked queue of 10, flag chips color-coded, STALLED
(amber) vs RATIONAL_PAUSE (grey) badges, expandable rows showing score breakdown, AI brief,
and WhatsApp draft with a copy button. Dense, clean, internal-tool style, light theme,
single accent color. Desktop only.
```

### Prompt 7, Leadership screen
```
Build /leadership per CLAUDE.md Screen 2: revenue-at-risk by stage bar chart, funnel
leakage waterfall, cross-sell attachment rates, handover pipeline card with total future
commission AED, eval results panel rendering the confusion matrix and brief pass rate,
and a "recovered this month" placeholder. Use recharts. Same visual language as Screen 1.
Also build the read-only /rules page per CLAUDE.md Screen 3: all rules as condition → action
blocks, grouped (risk flags, cross-sell, bank selection, classifier). Add top nav across
the three routes.
```

### Prompt 8, polish and ship
```
1) Add a small header: "HOME Intelligence Layer, prototype by Swa [lastname]" with a
one-line disclaimer: "Synthetic data. Built as a working proposal, not affiliated with Holo."
2) Write README.md: what it is, the three questions it answers, rules-first rationale,
eval approach, and a Phase 1/2/3 roadmap (rules now, propensity models once rules generate
labels, eval-gated agentic interventions later).
3) Run a production build, fix any errors.
```
Then deploy yourself: `npx vercel` from the repo root, follow prompts, then `npx vercel --prod`. Confirm the public link works in an incognito window. Push the repo to GitHub (public), confirm .env is not in it.

### Submission package (built after the app, not by Claude Code)
1. Vercel link
2. One-page memo: her five questions mapped in a table (question → what the prototype does → to what extent → what production adds, honest percentages); funnel leakage map; buyer-side insights from the calculator plus Concierge-call field notes as voice-of-customer evidence; rules-before-models sequencing argument; production architecture note (write-back into HOME, warehouse, feedback loop as label source)
3. Half-page "Week 1 inside HOME": which assumptions are guesses, what data validates them, first measurable win (insurance attachment rate on signed cases)
4. 90-second Loom
5. Public GitHub repo link

### Acceptance checklist before sending
- [ ] Link opens for a stranger (incognito test)
- [ ] Every flagged case shows a plain-English reason with real numbers
- [ ] At least one RATIONAL_PAUSE case visibly shows suppressed cross-sell ("held: client is re-evaluating")
- [ ] Confusion matrix visible and honest (do not hide a weak class, discuss it in the memo)
- [ ] All 20 WhatsApp drafts personally reviewed
- [ ] No API key anywhere in repo or deployment
- [ ] Disclaimer visible
- [ ] Loom recorded: 90 seconds, Screen 1 story first (one STALLED case, one RATIONAL_PAUSE case, one handover-pipeline case), then 20 seconds on Leadership + evals
