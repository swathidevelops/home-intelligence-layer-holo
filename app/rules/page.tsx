// Screen 3 — Rules page (/rules). Read-only. Renders every active rule as a
// plain condition → action block, so the whole engine is legible and challengeable.
// A rule-builder UI is the obvious Phase 2; this is the static view of the table.

import type { ReactNode } from 'react';

function Rule({
  label,
  when,
  then,
  tone = 'slate',
}: {
  label: string;
  when: ReactNode;
  then: ReactNode;
  tone?: 'amber' | 'rose' | 'accent' | 'slate';
}) {
  const dot = {
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    accent: 'bg-accent',
    slate: 'bg-slate-400',
  }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
      </div>
      <div className="space-y-1.5 text-sm">
        <p className="text-slate-600">
          <span className="mr-2 font-mono text-xs uppercase tracking-wide text-slate-400">
            when
          </span>
          {when}
        </p>
        <p className="text-slate-600">
          <span className="mr-2 font-mono text-xs uppercase tracking-wide text-accent">then</span>
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

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-[1180px] px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight text-slate-900">Rules</h1>
      <p className="mb-6 max-w-3xl text-sm text-slate-500">
        The whole engine is a legible rule table — no black box. Every rule below is a plain
        condition → action anyone at Holo could challenge. Stage benchmarks are computed from the
        book itself; a rule-builder UI is the obvious Phase 2.
      </p>

      <Section
        title="Early warnings"
        blurb="Fire before anything goes wrong. These are time-sensitive alerts, not stalls — the client may still be fully engaged."
      >
        <Rule
          tone="amber"
          label="Pre-approval expiring soon"
          when="pre-approval issued 60 days ago is within 14 days of lapsing, and the case is still before final offer"
          then="flag to lock the property or re-issue before it expires"
        />
        <Rule
          tone="amber"
          label="Big payment due, client silent"
          when="offplan case with a payment milestone due within 30 days and no inbound reply in the last 10 days"
          then="flag so the RM reaches out before the milestone lands"
        />
        <Rule
          tone="amber"
          label="Handover approaching"
          when="offplan property with handover within 180 days"
          then="schedule pre-arrangement outreach to line up the mortgage before completion"
        />
        <Rule
          tone="amber"
          label="Valuation taking too long"
          when="valuation requested and still not completed after more than 5 working days"
          then="flag the SLA breach and chase the valuer"
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
        />
        <Rule
          tone="rose"
          label="Quiet during transfer wait"
          when="two-bank transfer, signed 45+ days ago, with no inbound reply in 14 days"
          then="flag as process-blocked — chase the bank, do not nurture the client"
        />
        <Rule
          tone="rose"
          label="Not responding to outreach"
          when="3 or more outbound messages with zero inbound over the last 10 days"
          then="flag as gone quiet"
        />
        <Rule
          tone="rose"
          label="Documents holding this up"
          when="2+ documents outstanding at application or valuation, with no document activity for 5+ days"
          then="flag as docs stuck"
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
        />
        <Rule
          tone="slate"
          label="Rational pause (release)"
          when="a stall flag fired, no reply for 14+ days, and stalled more than 21 days"
          then="RATIONAL_PAUSE — customer-paused → rate-watch nurture; process-blocked (transfer) → chase the bank"
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
        />
        <Rule
          tone="accent"
          label="Life insurance gap"
          when="signed or later without life insurance attached"
          then="flag the compliance gap — life insurance is mandatory with a UAE mortgage"
        />
        <Rule
          tone="slate"
          label="Suppression (no friction)"
          when="a case is classified RATIONAL_PAUSE"
          then="hold every cross-sell and active-outreach recommendation — shown greyed as 'held: client is re-evaluating' — and assign only the nurture track"
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
        />
        <Rule
          tone="rose"
          label="DBR conflict"
          when="the case DBR exceeds the selected bank's limit but fits another candidate's limit"
          then="surface the conflict and suggest switching before submission"
        />
        <Rule
          tone="slate"
          label="Payout-event note"
          when="the selected bank pays commission at disbursal rather than approval"
          then="note the longer revenue-at-risk window through the funding period"
        />
        <Rule
          tone="slate"
          label="Assumption labelling"
          when="showing a bank's approval probability"
          then="label it a static per-segment assumption, never a prediction"
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
        />
      </Section>
    </main>
  );
}
