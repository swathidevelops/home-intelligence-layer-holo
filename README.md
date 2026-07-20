# HOME Intelligence Layer

A working prototype of an intelligence layer over Holo's mortgage book: it reads a synthetic
book of 400 UAE residential-mortgage cases and answers three questions, explainably, with no
black box.

> **Synthetic data. Built as a working proposal by Swathi Naik — not affiliated with Holo.**
> The deployed app makes no API calls and holds no live data.

**Live demo:** _add Vercel link here_ · **Three screens:** Today (case manager) · Leadership · Rules

---

## The three questions it answers

1. **Which cases are at risk — and is each one recoverable or a rational pause?**
   Seven risk rules flag cases, then a classifier splits the flagged ones into **STALLED**
   (still engaged → call/nudge) vs **RATIONAL_PAUSE** (gone quiet since costs were disclosed →
   move to nurture, stop active RM time). Rational pauses further split into *customer-paused*
   (nurture) vs *process-blocked* (chase the bank, don't nurture the client).

2. **What is the next best action for each case manager today?**
   A ranked action queue per RM, ordered by AED at stake
   (`expected commission × stage-close probability × staleness decay`), each row carrying a
   plain-English reason with real numbers.

3. **Which cross-sell triggers should fire right now, and why?**
   Conveyancing, mandatory life-insurance gaps, and offplan handover pipeline — **suppressed
   automatically** whenever a client is re-evaluating, so the system never adds friction to a
   pause.

## Scope

- **Funnel:** mid-to-end only (pre-approval → disbursed + service attachment). Acquisition and
  onboarding are out of scope.
- **Entity:** Holo Mortgage UAE as system of record; Concierge modeled as a source channel and
  attachable service. KSA is addressed as architecture (per-market config on the same rules),
  not build.
- **Segment:** residential only. Ready-vs-offplan, borrower profile, and buyer purpose are baked
  into the rules rather than bolted on as filters.

---

## Why rules first

Holo doesn't yet have labelled outcomes to train a model on — so the honest, shippable first
step is a **legible rule engine** anyone at Holo can read and challenge (see the `/rules` page:
the entire engine is a condition → action table). Rules generate the labels; the labels train
the models later. Every output carries a human-readable reason with the exact numbers that fired
it — no percentiles, no code names, no jargon on screen.

## How it's evaluated

Evaluation is built in, not an afterthought:

- **Classifier eval** — 30 cases hand-labelled by judgment, run against the engine.
  First pass scored **66.7%**; two eval-driven fixes lifted it to **90%** (macro-F1 0.88), with
  RATIONAL_PAUSE at perfect precision and recall. The fixes were real: (1) an early-warning flag
  (a slow valuer, a looming deadline) is not a stall; (2) process-blocked ≠ customer-paused. The
  three residual disagreements are left **honest and visible** on the Leadership screen rather
  than tuned away — chasing them would overfit 30 labels.
- **LLM-brief eval** — every AI-generated brief is programmatically checked: every number exists
  in the case record, the recommended action matches the engine, no client details are invented,
  and the WhatsApp draft is under 60 words.

## Deviations from the spec (and why)

The full build spec is in [`claude.md`](claude.md). The shipped engine deviates from it in a few
deliberate places — every one is evidence-driven, and I kept the spec as-written so the plan and
the improvements on it are both visible.

- **Seven risk flags, not five.** The spec's rules table always listed seven; one prompt said
  "five". Implemented all seven — otherwise two planted leakage patterns would go undetected.
- **The classifier gates on *stall-detection* flags only.** Early-warning flags (pre-approval
  expiry, payment cliff, valuation SLA) are time-bound alerts, not stalls — a slow valuer while
  the client is still replying is not a stalled client. This fix moved the classifier eval from
  **66.7% → 90%**.
- **RATIONAL_PAUSE split by cause.** Relaxed to "silent 14+ days and stalled 21+ days", then split
  into *customer-paused* (the client stepped back → rate-watch / rent-vs-buy nurture) vs
  *process-blocked* (a two-bank transfer is stuck → chase the bank, **don't** nurture the client).
  Cross-sell is suppressed for both.
- **Terminal-stage exclusions.** `VELOCITY_STALL` and `CONVEYANCING_ATTACH` don't fire on
  `disbursed` — a funded deal can't stall, and conveyancing is a pre-closing service.
- **Model.** Briefs use `claude-sonnet-5`; the spec's `claude-sonnet-4-6` predates the current
  Sonnet (overridable via `BRIEF_MODEL`).
- **Brief eval refinement.** The "no invented details" check was tightened to inspect only
  mid-sentence capitalised tokens, after it false-flagged sentence-openers ("Wanted", "Quick") and
  acronyms ("SLA") as hallucinations.

## Architecture

Everything is computed offline and committed; the deployed app is static.

```
generate_cases.py    -> data/cases.json        (400 synthetic cases, seeded, 9 planted leaks)
lib/engine.ts        -> flags/classifier/triggers/priority/bank-fit  (pure functions)
run_evals.py         -> data/eval_results.json  (confusion matrix + brief checks)
generate_ai_briefs.py-> data/ai_briefs.json     (Anthropic API, run locally once, committed)
Next.js (App Router) -> reads the JSON, runs the engine at build time, renders 3 screens
Vercel               -> static public link, no API keys in the deployment
```

The rules exist **twice** — once in TypeScript (`lib/engine.ts`, what the app runs) and once in
Python (`scripts/generate_cases.py`, what plants and verifies the data). A parity test
(`lib/engine.integration.test.ts`) asserts both implementations agree exactly on the committed
book, so the engine you demo and the data it reads are provably consistent.

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000

npm test               # engine unit tests + Python↔TS parity (Vitest)
npm run gen:cases      # regenerate the synthetic book (py scripts/generate_cases.py)
npm run gen:evals      # recompute eval_results.json
```

Generating the AI briefs is a one-time local step and needs a key (never committed, never
deployed):

```bash
py -m pip install anthropic
cp .env.example .env    # then set ANTHROPIC_API_KEY=sk-ant-...
npm run gen:briefs      # top-20 flagged cases -> data/ai_briefs.json, then re-runs the eval
```

## Roadmap

- **Phase 1 — Rules (now).** Legible rule engine, per-RM action queue, cross-sell with
  suppression, bank-fit optimisation, eval harness. Ships value on day one and generates the
  labels Phase 2 needs.
- **Phase 2 — Models.** Once the rules have produced enough outcome labels, replace static
  assumptions (approval probability, stall likelihood) with propensity models — trained on the
  labels the rules generated, still explained through the same reason surface.
- **Phase 3 — Eval-gated agentic interventions.** Let the system draft and, behind the same
  programmatic eval gate, send low-risk interventions itself (nudges, nurture drips, doc chases),
  writing outcomes back into HOME to close the feedback loop.

---

_Prototype for a Holo Principal PM submission. Built with Claude Code. Synthetic data throughout._
