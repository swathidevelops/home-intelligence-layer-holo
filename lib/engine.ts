// HOME Intelligence Layer — rules engine.
//
// Pure functions, no React, no I/O. Every output carries a humanReadableReason
// that states the exact rule that fired with real numbers and NO internal code
// names, percentiles, or jargon (per CLAUDE.md: the UI shows only labels + reasons).
//
// Time anchor: the synthetic book is generated against a fixed reference date
// (see scripts/generate_cases.py). The engine must treat that same date as
// "today" or the time-based flags won't line up with what was planted. All
// functions accept an optional `now` (YYYY-MM-DD) defaulting to REFERENCE_DATE.
//
// NOTE ON FLAG COUNT: Prompt 3's text says "five risk flags", but CLAUDE.md
// defines seven and the generator plants all seven. CLAUDE.md is authoritative,
// so all seven are implemented here.

// --------------------------------------------------------------------------- //
// Types
// --------------------------------------------------------------------------- //

export type Stage =
  | 'lead'
  | 'pre_approval'
  | 'property_found'
  | 'application'
  | 'valuation'
  | 'final_offer'
  | 'signed'
  | 'disbursed';

export interface BankOption {
  bank_name: string;
  rate: number; // customer rate, in percent (e.g. 4.25)
  commission_pct: number; // decimal (e.g. 0.009)
  payout_event: 'approval' | 'disbursal';
  approval_probability: number; // STATIC per-segment assumption, never a prediction
  avg_days_to_fund: number;
  dbr_limit: number; // decimal (e.g. 0.50)
  selected: boolean;
}

export interface Activity {
  date: string; // YYYY-MM-DD
  direction: 'outbound' | 'inbound';
  channel: 'whatsapp' | 'email' | 'call';
  type: string;
}

export interface StageHistoryEntry {
  stage: Stage;
  entered_at: string; // YYYY-MM-DD
}

export interface PaymentMilestone {
  due_date: string; // YYYY-MM-DD
  amount: number;
}

export interface Case {
  id: string;
  client_name: string;
  segment: 'salaried' | 'self_employed';
  residency: 'resident' | 'non_resident';
  purpose: 'end_use' | 'investment';
  property_type: 'ready' | 'offplan';
  property_price: number;
  loan_amount: number;
  ltv: number;
  stage: Stage;
  dbr: number; // decimal (e.g. 0.47)
  bank_options: BankOption[];
  expected_commission: number;
  valuation_status: 'not_requested' | 'requested' | 'completed' | 'issue';
  valuation_requested_date: string | null;
  stage_history: StageHistoryEntry[];
  assigned_rm: string;
  source_channel: 'organic' | 'agent_referral' | 'concierge' | 'paid';
  pre_approval_date: string | null;
  payment_milestones: PaymentMilestone[] | null;
  handover_date: string | null;
  activities: Activity[];
  docs_outstanding: number;
  services_attached: string[];
  transfer_type: 'one_bank' | 'two_bank' | null;
}

export type RiskFlagCode =
  | 'VELOCITY_STALL'
  | 'PAYMENT_CLIFF'
  | 'PRE_APPROVAL_EXPIRY'
  | 'TRANSFER_TUNNEL'
  | 'GONE_QUIET'
  | 'VALUATION_OVERDUE'
  | 'DOCS_STUCK';

export interface RiskFlag {
  code: RiskFlagCode; // internal — never render this
  label: string; // UI display label
  humanReadableReason: string;
}

export type CrossSellCode =
  | 'CONVEYANCING_ATTACH'
  | 'LIFE_INSURANCE_GAP'
  | 'HANDOVER_PIPELINE';

export interface CrossSellTrigger {
  code: CrossSellCode; // internal — never render this
  label: string;
  framing: string;
  humanReadableReason: string;
  suppressed: boolean; // true when the case is RATIONAL_PAUSE
}

export type Classification = 'STALLED' | 'RATIONAL_PAUSE' | 'HEALTHY';

/**
 * Why a case is paused. `customer_paused` = the client stepped back after seeing
 * costs (nurture them). `process_blocked` = the client is fine but the pipeline
 * is stuck, e.g. a bank transfer (chase the process, do NOT nurture the client).
 */
export type PauseKind = 'customer_paused' | 'process_blocked';

export interface ClassificationResult {
  classification: Classification;
  humanReadableReason: string;
  recommendedAction: string;
  pauseKind: PauseKind | null;
}

export interface PriorityResult {
  score: number;
  stageProbability: number;
  stalenessDecay: number;
  daysSinceLastActivity: number | null;
  humanReadableReason: string;
}

export interface BankRevenue extends BankOption {
  expected_funded_revenue: number; // loan_amount * commission_pct * approval_probability
  fits_dbr: boolean; // case dbr <= this bank's dbr_limit
}

export interface BankAnalysis {
  banks: BankRevenue[];
  selected: BankRevenue;
  revenueOptimal: BankRevenue;
  recommendSwitch: boolean;
  switchReason: string | null;
  dbrConflict: boolean;
  dbrConflictReason: string | null;
  fairnessGuardrailNote: string;
  payoutNote: string;
}

export interface NurtureTrack {
  track: 'rent_vs_buy' | 'rate_yield_watch';
  humanReadableReason: string;
}

export interface CaseAnalysis {
  id: string;
  priority: PriorityResult;
  flags: RiskFlag[];
  classification: ClassificationResult;
  crossSell: CrossSellTrigger[];
  bank: BankAnalysis;
  nurtureTrack: NurtureTrack | null; // set only for RATIONAL_PAUSE
}

// --------------------------------------------------------------------------- //
// Constants
// --------------------------------------------------------------------------- //

export const REFERENCE_DATE = '2026-07-20';

export const STAGES: Stage[] = [
  'lead',
  'pre_approval',
  'property_found',
  'application',
  'valuation',
  'final_offer',
  'signed',
  'disbursed',
];

const STAGE_INDEX: Record<Stage, number> = STAGES.reduce(
  (acc, s, i) => ((acc[s] = i), acc),
  {} as Record<Stage, number>
);

// stage_probability from CLAUDE.md; disbursed (funded) treated as 1.0.
export const STAGE_PROBABILITY: Record<Stage, number> = {
  lead: 0.15,
  pre_approval: 0.35,
  property_found: 0.5,
  application: 0.55,
  valuation: 0.65,
  final_offer: 0.85,
  signed: 0.95,
  disbursed: 1.0,
};

// Friendly stage names for reason sentences (no code names in the UI).
const STAGE_LABEL: Record<Stage, string> = {
  lead: 'lead',
  pre_approval: 'pre-approval',
  property_found: 'property search',
  application: 'application',
  valuation: 'valuation',
  final_offer: 'final offer',
  signed: 'signing',
  disbursed: 'disbursed',
};

const FLAG_LABELS: Record<RiskFlagCode, string> = {
  VELOCITY_STALL: 'Stuck longer than normal',
  PAYMENT_CLIFF: 'Big payment due, client silent',
  PRE_APPROVAL_EXPIRY: 'Pre-approval expiring soon',
  TRANSFER_TUNNEL: 'Quiet during transfer wait',
  GONE_QUIET: 'Not responding to outreach',
  VALUATION_OVERDUE: 'Valuation taking too long',
  DOCS_STUCK: 'Documents holding this up',
};

const VALUATION_SLA_WORKING_DAYS = 5;
const PRE_APPROVAL_VALID_DAYS = 60;

/**
 * CLAUDE.md's /rules page splits the flags into two groups, and the classifier
 * respects that split: only "stall detection" flags (something already slowed)
 * can make a case STALLED or RATIONAL_PAUSE. The remaining "early warning" flags
 * (pre-approval expiry, payment cliff, valuation SLA) are time-bound alerts that
 * still need action but do NOT mean the client has stalled — treating them as
 * stalls was the single biggest source of false STALLED calls in the eval.
 */
const STALL_FLAG_CODES: RiskFlagCode[] = [
  'VELOCITY_STALL',
  'TRANSFER_TUNNEL',
  'GONE_QUIET',
  'DOCS_STUCK',
];

// --------------------------------------------------------------------------- //
// Date + formatting helpers
// --------------------------------------------------------------------------- //

const DAY_MS = 86_400_000;

function ms(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days between `dateStr` and `now` (positive = in the past). */
export function daysAgo(dateStr: string, now: string = REFERENCE_DATE): number {
  return Math.floor((ms(now) - ms(dateStr)) / DAY_MS);
}

/** Whole days from `now` until `dateStr` (positive = in the future). */
export function daysUntil(dateStr: string, now: string = REFERENCE_DATE): number {
  return Math.floor((ms(dateStr) - ms(now)) / DAY_MS);
}

/** Weekdays strictly after `dateStr` up to and including `now`. */
export function workingDaysSince(dateStr: string, now: string = REFERENCE_DATE): number {
  let cur = ms(dateStr);
  const end = ms(now);
  let count = 0;
  while (cur < end) {
    cur += DAY_MS;
    const wd = new Date(cur).getUTCDay();
    if (wd >= 1 && wd <= 5) count += 1;
  }
  return count;
}

function fmtAED(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function pct(decimal: number): number {
  return Math.round(decimal * 100);
}

// --------------------------------------------------------------------------- //
// Activity + dwell helpers
// --------------------------------------------------------------------------- //

export function currentDwell(c: Case, now: string = REFERENCE_DATE): number {
  const entry = c.stage_history[c.stage_history.length - 1];
  return daysAgo(entry.entered_at, now);
}

function daysSinceLastActivity(c: Case, now: string = REFERENCE_DATE): number | null {
  if (c.activities.length === 0) return null;
  return Math.min(...c.activities.map((a) => daysAgo(a.date, now)));
}

function daysSinceLastInbound(c: Case, now: string = REFERENCE_DATE): number | null {
  const inbound = c.activities.filter((a) => a.direction === 'inbound');
  if (inbound.length === 0) return null;
  return Math.min(...inbound.map((a) => daysAgo(a.date, now)));
}

function noInboundInLast(c: Case, n: number, now: string = REFERENCE_DATE): boolean {
  const li = daysSinceLastInbound(c, now);
  return li === null || li > n;
}

function countDirectionInLast(
  c: Case,
  direction: 'inbound' | 'outbound',
  n: number,
  now: string = REFERENCE_DATE
): number {
  return c.activities.filter(
    (a) => a.direction === direction && daysAgo(a.date, now) <= n
  ).length;
}

function stageEnteredAt(c: Case, stage: Stage): string | null {
  const entry = c.stage_history.find((h) => h.stage === stage);
  return entry ? entry.entered_at : null;
}

// --------------------------------------------------------------------------- //
// Stage-dwell benchmarks (p75), computed from the dataset itself
// --------------------------------------------------------------------------- //

function percentile75(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const k = Math.min(Math.max(Math.ceil(0.75 * sorted.length) - 1, 0), sorted.length - 1);
  return sorted[k];
}

/** p75 current-stage dwell per stage, drawn from the whole book. */
export function computeStageBenchmarks(
  cases: Case[],
  now: string = REFERENCE_DATE
): Record<string, number> {
  const buckets: Record<string, number[]> = {};
  for (const c of cases) {
    (buckets[c.stage] ||= []).push(currentDwell(c, now));
  }
  const out: Record<string, number> = {};
  for (const stage of Object.keys(buckets)) {
    out[stage] = percentile75(buckets[stage]);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Priority score
// --------------------------------------------------------------------------- //

export function stalenessDecay(daysSince: number | null): number {
  if (daysSince === null) return 0.2;
  if (daysSince < 7) return 1.0;
  if (daysSince < 14) return 0.7;
  if (daysSince < 30) return 0.4;
  return 0.2;
}

export function priorityScore(c: Case, now: string = REFERENCE_DATE): PriorityResult {
  const days = daysSinceLastActivity(c, now);
  const decay = stalenessDecay(days);
  const sp = STAGE_PROBABILITY[c.stage];
  const score = c.expected_commission * sp * decay;

  const freshness =
    days === null
      ? 'no activity on record'
      : days < 7
      ? 'active this week'
      : days < 14
      ? 'quiet for about two weeks'
      : days < 30
      ? 'quiet for about a month'
      : 'cold for over a month';

  return {
    score,
    stageProbability: sp,
    stalenessDecay: decay,
    daysSinceLastActivity: days,
    humanReadableReason: `AED ${fmtAED(c.expected_commission)} in expected commission, ${pct(
      sp
    )}% likely to close from ${STAGE_LABEL[c.stage]}, ${freshness}.`,
  };
}

// --------------------------------------------------------------------------- //
// Risk flags
// --------------------------------------------------------------------------- //

function quietPhrase(li: number | null): string {
  return li === null ? 'with no reply on record' : `with no reply in ${li} days`;
}

export function riskFlags(
  c: Case,
  benchmarks: Record<string, number>,
  now: string = REFERENCE_DATE
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const sidx = STAGE_INDEX[c.stage];
  const dwell = currentDwell(c, now);

  const add = (code: RiskFlagCode, reason: string) =>
    flags.push({ code, label: FLAG_LABELS[code], humanReadableReason: reason });

  // VELOCITY_STALL — dwell in current stage beyond the book's typical (p75).
  // Never fires on `disbursed`: the loan is funded and the case is closed, so
  // "stuck longer than normal" is meaningless there (and not an intervention).
  const benchmark = benchmarks[c.stage];
  if (c.stage !== 'disbursed' && benchmark !== undefined && dwell > benchmark) {
    add(
      'VELOCITY_STALL',
      `Stuck at ${STAGE_LABEL[c.stage]} for ${dwell} days, typical is ${benchmark}.`
    );
  }

  // PAYMENT_CLIFF — offplan milestone due within 30 days AND no inbound in 10 days.
  if (c.property_type === 'offplan' && c.payment_milestones) {
    if (noInboundInLast(c, 10, now)) {
      const soon = c.payment_milestones
        .map((m) => ({ ...m, due: daysUntil(m.due_date, now) }))
        .filter((m) => m.due >= 0 && m.due <= 30)
        .sort((a, b) => a.due - b.due)[0];
      if (soon) {
        const li = daysSinceLastInbound(c, now);
        add(
          'PAYMENT_CLIFF',
          `AED ${fmtAED(soon.amount)} payment due in ${soon.due} days, ${quietPhrase(li)}.`
        );
      }
    }
  }

  // PRE_APPROVAL_EXPIRY — pre-approval lapses within 14 days AND stage < final_offer.
  if (c.pre_approval_date && sidx < STAGE_INDEX.final_offer) {
    const expiry = daysUntil(c.pre_approval_date, now) + PRE_APPROVAL_VALID_DAYS;
    if (expiry >= 0 && expiry <= 14) {
      add(
        'PRE_APPROVAL_EXPIRY',
        `Pre-approval expires in ${expiry} days while still at ${STAGE_LABEL[c.stage]}.`
      );
    }
  }

  // TRANSFER_TUNNEL — two-bank, signed, 45+ days in stage, no inbound in 14 days.
  if (
    c.transfer_type === 'two_bank' &&
    c.stage === 'signed' &&
    dwell >= 45 &&
    noInboundInLast(c, 14, now)
  ) {
    const li = daysSinceLastInbound(c, now);
    add(
      'TRANSFER_TUNNEL',
      `In the two-bank transfer wait for ${dwell} days, ${quietPhrase(li)}.`
    );
  }

  // GONE_QUIET — 3+ outbound and zero inbound over the last 10 days.
  const outbound10 = countDirectionInLast(c, 'outbound', 10, now);
  const inbound10 = countDirectionInLast(c, 'inbound', 10, now);
  if (outbound10 >= 3 && inbound10 === 0) {
    add('GONE_QUIET', `${outbound10} messages sent in the last 10 days with no reply.`);
  }

  // VALUATION_OVERDUE — requested and aging beyond the 5 working-day SLA.
  if (c.valuation_status === 'requested' && c.valuation_requested_date) {
    const wd = workingDaysSince(c.valuation_requested_date, now);
    if (wd > VALUATION_SLA_WORKING_DAYS) {
      add(
        'VALUATION_OVERDUE',
        `Valuation requested ${wd} working days ago, the benchmark is ${VALUATION_SLA_WORKING_DAYS}.`
      );
    }
  }

  // DOCS_STUCK — 2+ docs outstanding at application/valuation, no doc activity in 5+ days.
  if (c.docs_outstanding >= 2 && (c.stage === 'application' || c.stage === 'valuation')) {
    const docTouches = c.activities
      .filter((a) => a.type.includes('doc'))
      .map((a) => daysAgo(a.date, now));
    const lastDoc = docTouches.length ? Math.min(...docTouches) : null;
    if (lastDoc === null || lastDoc > 5) {
      const gap = lastDoc === null ? 'none logged yet' : `${lastDoc} days`;
      add(
        'DOCS_STUCK',
        `${c.docs_outstanding} documents outstanding with no movement for ${gap}.`
      );
    }
  }

  return flags;
}

// --------------------------------------------------------------------------- //
// Stall vs rational-pause classifier
// --------------------------------------------------------------------------- //

export function classify(
  c: Case,
  benchmarks: Record<string, number>,
  now: string = REFERENCE_DATE
): ClassificationResult {
  const flags = riskFlags(c, benchmarks, now);
  const stallFlags = flags.filter((f) => STALL_FLAG_CODES.includes(f.code));
  const earlyWarnings = flags.filter((f) => !STALL_FLAG_CODES.includes(f.code));

  // Only a stall-detection flag can make a case STALLED or RATIONAL_PAUSE.
  if (stallFlags.length === 0) {
    if (earlyWarnings.length > 0) {
      const plural = earlyWarnings.length > 1 ? 's' : '';
      return {
        classification: 'HEALTHY',
        humanReadableReason: `Moving normally — ${earlyWarnings.length} time-sensitive alert${plural} to act on, but the client has not stalled.`,
        recommendedAction: 'Act on the alert; no stall recovery needed.',
        pauseKind: null,
      };
    }
    return {
      classification: 'HEALTHY',
      humanReadableReason: 'No risk rule fired.',
      recommendedAction: 'No action needed.',
      pauseKind: null,
    };
  }

  // STALLED — still engaged: at least one inbound in the last 14 days.
  const li = daysSinceLastInbound(c, now);
  if (li !== null && li <= 14) {
    return {
      classification: 'STALLED',
      humanReadableReason: `Slowed down, but the client replied ${li} days ago, so it is recoverable.`,
      recommendedAction: 'Call or send a personal nudge.',
      pauseKind: null,
    };
  }

  // RATIONAL_PAUSE — gone silent and stalled longer than three weeks.
  const dwell = currentDwell(c, now);
  if (dwell > 21) {
    const quiet = li === null ? 'no reply on record' : `no reply in ${li} days`;

    // Process-blocked: the pipeline is stuck, not the client. Chase the process.
    if (stallFlags.some((f) => f.code === 'TRANSFER_TUNNEL')) {
      return {
        classification: 'RATIONAL_PAUSE',
        humanReadableReason: `Waiting ${dwell} days with ${quiet} — the process is blocked, not the client.`,
        recommendedAction:
          'Chase the bank or conveyancer for a transfer status update. Do not nurture the customer.',
        pauseKind: 'process_blocked',
      };
    }

    // Customer-paused: the client stepped back, usually after seeing costs.
    const valuationEntry = stageEnteredAt(c, 'valuation');
    const silentSinceCosts =
      valuationEntry !== null &&
      !c.activities.some(
        (a) => a.direction === 'inbound' && ms(a.date) >= ms(valuationEntry)
      );
    const reason = silentSinceCosts
      ? `No reply since costs were shared and stalled ${dwell} days — the client is re-evaluating.`
      : `Stalled ${dwell} days with ${quiet} — the client has stepped back.`;
    return {
      classification: 'RATIONAL_PAUSE',
      humanReadableReason: reason,
      recommendedAction: 'Move to rate-watch nurture and stop active RM time.',
      pauseKind: 'customer_paused',
    };
  }

  // Slowed, quiet, but not long enough to call it a pause yet.
  return {
    classification: 'HEALTHY',
    humanReadableReason: 'Slowed and quiet, but not long enough to call it a pause.',
    recommendedAction: 'Monitor.',
    pauseKind: null,
  };
}

// --------------------------------------------------------------------------- //
// Cross-sell triggers
// --------------------------------------------------------------------------- //

export function crossSellTriggers(
  c: Case,
  now: string = REFERENCE_DATE
): CrossSellTrigger[] {
  const triggers: CrossSellTrigger[] = [];
  const sidx = STAGE_INDEX[c.stage];
  const dwell = currentDwell(c, now);

  const add = (
    code: CrossSellCode,
    label: string,
    framing: string,
    reason: string
  ) =>
    triggers.push({ code, label, framing, humanReadableReason: reason, suppressed: false });

  // CONVEYANCING_ATTACH — at/after final offer, conveyancing not attached, 5+ days
  // in stage. Excludes 'disbursed': conveyancing is a pre-closing service, so once
  // the loan is funded there is nothing left to attach.
  if (
    sidx >= STAGE_INDEX.final_offer &&
    c.stage !== 'disbursed' &&
    !c.services_attached.includes('conveyancing') &&
    dwell >= 5
  ) {
    add(
      'CONVEYANCING_ATTACH',
      'Conveyancing not attached',
      'already inside your closing costs',
      `At ${STAGE_LABEL[c.stage]} for ${dwell} days with no conveyancing attached — it sits inside the closing costs already.`
    );
  }

  // LIFE_INSURANCE_GAP — signed or later without the mandatory life insurance.
  if (sidx >= STAGE_INDEX.signed && !c.services_attached.includes('life_insurance')) {
    add(
      'LIFE_INSURANCE_GAP',
      'Life insurance missing',
      'mandatory with UAE mortgages',
      `Case is at ${STAGE_LABEL[c.stage]} with no life insurance attached — it is mandatory with a UAE mortgage.`
    );
  }

  // HANDOVER_PIPELINE — offplan with handover within 180 days (pre-arrangement window).
  if (c.property_type === 'offplan' && c.handover_date) {
    const until = daysUntil(c.handover_date, now);
    if (until >= 0 && until <= 180) {
      add(
        'HANDOVER_PIPELINE',
        'Handover approaching',
        'scheduled pre-arrangement outreach',
        `Offplan handover is ${until} days away — time to line up the mortgage before completion.`
      );
    }
  }

  return triggers;
}

// --------------------------------------------------------------------------- //
// Bank selection intelligence
// --------------------------------------------------------------------------- //

const RATE_FAIRNESS_GUARDRAIL = 0.1; // percentage points

export function bankAnalysis(c: Case): BankAnalysis {
  const banks: BankRevenue[] = c.bank_options.map((b) => ({
    ...b,
    expected_funded_revenue: Math.round(
      c.loan_amount * b.commission_pct * b.approval_probability
    ),
    fits_dbr: c.dbr <= b.dbr_limit,
  }));

  const selected = banks.find((b) => b.selected) ?? banks[0];
  const revenueOptimal = banks.reduce((best, b) =>
    b.expected_funded_revenue > best.expected_funded_revenue ? b : best
  );

  // Fairness guardrail: only recommend a switch when the higher-revenue bank
  // does not push the customer's rate up by more than 0.10%.
  let recommendSwitch = false;
  let switchReason: string | null = null;
  if (
    revenueOptimal.bank_name !== selected.bank_name &&
    revenueOptimal.expected_funded_revenue > selected.expected_funded_revenue &&
    revenueOptimal.rate - selected.rate <= RATE_FAIRNESS_GUARDRAIL
  ) {
    recommendSwitch = true;
    switchReason = `Switching to ${revenueOptimal.bank_name} raises expected funded revenue from AED ${fmtAED(
      selected.expected_funded_revenue
    )} to AED ${fmtAED(
      revenueOptimal.expected_funded_revenue
    )} while keeping the customer rate within 0.10% (${selected.rate.toFixed(
      2
    )}% vs ${revenueOptimal.rate.toFixed(2)}%).`;
  }

  // DBR conflict: selected bank's limit is exceeded, but another candidate fits.
  let dbrConflict = false;
  let dbrConflictReason: string | null = null;
  if (c.dbr > selected.dbr_limit) {
    const fits = banks.find((b) => !b.selected && b.dbr_limit >= c.dbr);
    if (fits) {
      dbrConflict = true;
      dbrConflictReason = `DBR ${pct(c.dbr)}% exceeds ${selected.bank_name} limit ${pct(
        selected.dbr_limit
      )}%, fits ${fits.bank_name} (limit ${pct(
        fits.dbr_limit
      )}%) — suggest switch before submission.`;
    }
  }

  const payoutNote =
    selected.payout_event === 'disbursal'
      ? `${selected.bank_name} pays commission at disbursal, so it stays at risk through the full funding window (about ${selected.avg_days_to_fund} days).`
      : `${selected.bank_name} pays commission at approval, so it is realized earlier than disbursal-payout lenders.`;

  return {
    banks,
    selected,
    revenueOptimal,
    recommendSwitch,
    switchReason,
    dbrConflict,
    dbrConflictReason,
    fairnessGuardrailNote:
      'A switch is only recommended when the higher-revenue bank keeps the customer rate within 0.10%. Approval probabilities are static assumptions, not predictions.',
    payoutNote,
  };
}

// --------------------------------------------------------------------------- //
// Full per-case analysis (convenience for the UI)
// --------------------------------------------------------------------------- //

function nurtureFor(c: Case): NurtureTrack {
  if (c.purpose === 'end_use') {
    return {
      track: 'rent_vs_buy',
      humanReadableReason:
        'End-user re-evaluating — keep warm with rent-vs-buy framing, no active push.',
    };
  }
  return {
    track: 'rate_yield_watch',
    humanReadableReason:
      'Investor re-evaluating — keep warm with rate and yield watch, no active push.',
  };
}

export function analyzeCase(
  c: Case,
  benchmarks: Record<string, number>,
  now: string = REFERENCE_DATE
): CaseAnalysis {
  const classification = classify(c, benchmarks, now);
  const isPause = classification.classification === 'RATIONAL_PAUSE';

  // Suppression rule: for ANY rational pause the client is silent, so every
  // cross-sell is held regardless of why the case is paused.
  const crossSell = crossSellTriggers(c, now).map((t) => ({
    ...t,
    suppressed: isPause,
  }));

  // A nurture track only makes sense when the CLIENT stepped back. A
  // process-blocked case needs the pipeline chased, not the customer drip-fed.
  const nurtureTrack =
    isPause && classification.pauseKind === 'customer_paused' ? nurtureFor(c) : null;

  return {
    id: c.id,
    priority: priorityScore(c, now),
    flags: riskFlags(c, benchmarks, now),
    classification,
    crossSell,
    bank: bankAnalysis(c),
    nurtureTrack,
  };
}

/** Analyze the whole book: compute benchmarks once, return analyses sorted by priority. */
export function analyzeBook(
  cases: Case[],
  now: string = REFERENCE_DATE
): CaseAnalysis[] {
  const benchmarks = computeStageBenchmarks(cases, now);
  return cases
    .map((c) => analyzeCase(c, benchmarks, now))
    .sort((a, b) => b.priority.score - a.priority.score);
}
