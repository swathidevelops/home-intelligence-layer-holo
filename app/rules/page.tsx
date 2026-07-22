// Screen 3 — Rules page (/rules). Read-only. Renders every active rule as a
// plain condition → action block, so the whole engine is legible and challengeable.
// A rule-builder UI is the obvious Phase 2; this is the static view of the table.

import type { ReactNode } from 'react';

function Rule({
  label,
  when,
  then,
  tone = 'slate',
  trust = 'deterministic',
}: {
  label: string;
  when: ReactNode;
  then: ReactNode;
  tone?: 'amber' | 'rose' | 'accent' | 'slate';
  trust?: 'deterministic' | 'threshold' | 'scored';
}) {
  const dot = {
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    accent: 'bg-accent',
    slate: 'bg-slate-400',
  }[tone];

  const trustLabel = {
    deterministic: 'Deterministic',
    threshold: 'Threshold',
    scored: 'Scored',
  }[trust];

  const trustColor = {
    deterministic: 'text-slate-500',
    threshold: 'text-amber-600',
    scored: 'text-accent',
  }[trust];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
        </div>
        <span className={`text-[11px] font-medium ${trustColor}`}>{trustLabel}</span>
      </div>
      <div className="space-y-1.5 text-sm">
        <p className="text-slate-600">
          <span className="mr-2 font-semibold text-slate-700">When:</span>
          {when}
        </p>
        <p className="text-slate-600">
          <span className="mr-2 font-semibold text-slate-700">Then:</span>
          {then}
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mb-3 text-sm text-slate-500">{blurb}</p>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function FlowStep({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
        →
      </div>
      <div className="text-sm font-medium text-slate-800">{label}</div>
      <div className="text-xs text-slate-500">{description}</div>
    </div>
  );
}

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-[1180px] px-6 py-6">
      {/* Hero section */}
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-slate-900">
          How HOME decides what matters now
        </h1>
        <p className="mb-4 max-w-3xl text-lg text-slate-600">
          Every recommendation is based on clear rules, explainable signals, and measurable outcomes.
        </p>
        <p className="max-w-3xl text-sm text-slate-500">
          This page shows the complete logic behind the priority queue, risk detection, and customer
          suppression. No black box — every rule is auditable and can be challenged or tuned. Stage
          benchmarks are computed from the book itself and self-calibrate automatically.
        </p>
      </div>

      {/* Flow diagram */}
      <div className="mb-8 rounded-lg border border-slate-200 bg-slate-50 p-6">
        <div className="mb-4 text-xs font-semibold text-slate-700">SIGNAL TO DECISION</div>
        <div className="flex justify-between gap-2 text-xs md:gap-4">
          <FlowStep label="Data signal" description="Case event or timestamp" />
          <FlowStep label="Rule fires" description="Trigger condition met" />
          <FlowStep label="Classification" description="Stalled vs rational pause" />
          <FlowStep label="Action queued" description="In morning queue" />
          <FlowStep label="Outcome tracked" description="Success or recovery" />
        </div>
      </div>

      {/* Rules sections */}
      <Section
        title="Early warnings"
        blurb="Fire before anything goes wrong. These are time-sensitive alerts, not stalls — the client may still be fully engaged."
      >
        <Rule
          tone="amber"
          label="Pre-approval expiring soon"
          when="pre-approval issued 60 days ago is within 14 days of lapsing, and the case is still before final offer"
          then="flag to lock the property or re-issue before it expires"
          trust="threshold"
        />
        <Rule
          tone="amber"
          label="Big payment due, client silent"
          when="offplan case with a payment milestone due within 30 days and no inbound reply in the last 10 days"
          then="flag so the RM reaches out before the milestone lands"
          trust="threshold"
        />
        <Rule
          tone="amber"
          label="Handover approaching"
          when="offplan property with handover within 180 days"
          then="schedule pre-arrangement outreach to line up the mortgage before completion"
          trust="threshold"
        />
        <Rule
          tone="amber"
          label="Valuation taking too long"
          when="valuation requested and still not completed after more than 5 working days"
          then="flag the SLA breach and chase the valuer"
          trust="threshold"
        />
      </Section>

      <Section
        title="Stall detection"
        blurb="Something already slowed. Only these flags can classify a case as stalled or paused."
      >
        <Rule
          tone="rose"
          label="Stuck longer than normal"
          when="dwell time in the current stage exceeds the typical (p75) for that stage — never on the funded 'disbursed' stage"
          then="flag as stuck and surface how many days vs typical"
          trust="scored"
        />
        <Rule
          tone="rose"
          label="Quiet during transfer wait"
          when="two-bank transfer, signed 45+ days ago, with no inbound reply in 14 days"
          then="flag as process-blocked — chase the bank, do not nurture the client"
          trust="threshold"
        />
        <Rule
          tone="rose"
          label="Not responding to outreach"
          when="3 or more outbound messages with zero inbound over the last 10 days"
          then="flag as gone quiet"
          trust="deterministic"
        />
        <Rule
          tone="rose"
          label="Documents holding this up"
          when="2+ documents outstanding at application or valuation, with no document activity for 5+ days"
          then="flag as docs stuck"
          trust="threshold"
        />
      </Section>

      <Section
        title="Stall vs rational-pause classifier"
        blurb="Runs only on flagged cases, and only stall-detection flags count. This is the 'recover vs release' decision."
      >
        <Rule
          tone="amber"
          label="Stalled (recoverable)"
          when="a stall flag fired and the client replied within the last 14 days"
          then="STALLED — still engaged, worth a call or nudge"
          trust="deterministic"
        />
        <Rule
          tone="slate"
          label="Rational pause (release)"
          when="a stall flag fired, no reply for 14+ days, and stalled more than 21 days"
          then="RATIONAL_PAUSE — customer-paused → rate-watch nurture; process-blocked (transfer) → chase the bank"
          trust="deterministic"
        />
      </Section>

      <Section
        title="Cross-sell triggers"
        blurb="Attach the right product at the right moment — and hold everything when the client is re-evaluating."
      >
        <Rule
          tone="accent"
          label="Conveyancing attach"
          when="at or after final offer, conveyancing not attached, 5+ days in stage"
          then="offer conveyancing — it's already inside the closing costs"
          trust="deterministic"
        />
        <Rule
          tone="accent"
          label="Life insurance gap"
          when="signed or later without life insurance attached"
          then="flag the compliance gap — life insurance is mandatory with a UAE mortgage"
          trust="deterministic"
        />
        <Rule
          tone="slate"
          label="Suppression (no friction)"
          when="a case is classified RATIONAL_PAUSE"
          then="hold every cross-sell and active-outreach recommendation — shown greyed as 'held: client is re-evaluating' — and assign only the nurture track"
          trust="deterministic"
        />
      </Section>

      <Section
        title="Bank selection intelligence"
        blurb="Optimise funded revenue without ever pushing the customer to a worse rate."
      >
        <Rule
          tone="accent"
          label="Revenue-optimal switch"
          when="another candidate bank has higher expected funded revenue (loan × commission × approval probability) AND its customer rate is within 0.10% of the selected bank"
          then="recommend the switch, stating the guardrail explicitly"
          trust="scored"
        />
        <Rule
          tone="rose"
          label="DBR conflict"
          when="the case DBR exceeds the selected bank's limit but fits another candidate's limit"
          then="surface the conflict and suggest switching before submission"
          trust="deterministic"
        />
        <Rule
          tone="slate"
          label="Payout-event note"
          when="the selected bank pays commission at disbursal rather than approval"
          then="note the longer revenue-at-risk window through the funding period"
          trust="deterministic"
        />
        <Rule
          tone="slate"
          label="Assumption labelling"
          when="showing a bank's approval probability"
          then="label it a static per-segment assumption, never a prediction"
          trust="deterministic"
        />
      </Section>

      <Section
        title="Priority score"
        blurb="How the action queue is ranked."
      >
        <Rule
          tone="accent"
          label="Priority = commission × stage × freshness"
          when="ranking each case"
          then="expected commission × stage-close probability × staleness decay (1.0 if active within 7 days, down to 0.2 when cold over a month)"
          trust="scored"
        />
      </Section>

      {/* Assumptions & calibration */}
      <div className="mt-12 border-t border-slate-200 pt-8">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Assumptions & calibration</h2>
        <div className="space-y-2 text-xs text-slate-500">
          <p>
            <span className="font-medium text-slate-600">Fixed thresholds:</span> Starting estimates
            tuned against HOME outcomes; stage benchmarks are computed from the book and
            self-calibrate.
          </p>
          <p>
            <span className="font-medium text-slate-600">Bank approval probabilities:</span> Static
            per-segment assumptions, not a trained model. Inputs for revenue optimization, not
            predictions.
          </p>
          <p>
            <span className="font-medium text-slate-600">Rules-first approach:</span> Transparent
            thresholds ship fast, build trust, and generate the labels future propensity models need.
          </p>
        </div>
      </div>
    </main>
  );
}
