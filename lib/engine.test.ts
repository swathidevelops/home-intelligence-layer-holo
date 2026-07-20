import { describe, it, expect } from 'vitest';
import {
  Case,
  BankOption,
  Activity,
  Stage,
  riskFlags,
  classify,
  crossSellTriggers,
  priorityScore,
  bankAnalysis,
  analyzeCase,
  computeStageBenchmarks,
  currentDwell,
  workingDaysSince,
  stalenessDecay,
} from './engine';

// Fixed "today" for all fixtures.
const NOW = '2026-07-20';

function daysBefore(n: number): string {
  const d = new Date(Date.UTC(2026, 6, 20) - n * 86_400_000);
  return d.toISOString().slice(0, 10);
}
function daysAfter(n: number): string {
  return daysBefore(-n);
}

function bank(overrides: Partial<BankOption> = {}): BankOption {
  return {
    bank_name: 'Emirates NBD',
    rate: 4.25,
    commission_pct: 0.009,
    payout_event: 'disbursal',
    approval_probability: 0.85,
    avg_days_to_fund: 22,
    dbr_limit: 0.5,
    selected: true,
    ...overrides,
  };
}

// A healthy baseline case: no flags should fire. Overrides shape each scenario.
function makeCase(overrides: Partial<Case> = {}): Case {
  const stage: Stage = overrides.stage ?? 'application';
  const dwell = 5;
  return {
    id: 'HOL-TEST',
    client_name: 'Test Client',
    segment: 'salaried',
    residency: 'resident',
    purpose: 'end_use',
    property_type: 'ready',
    property_price: 1_500_000,
    loan_amount: 1_125_000,
    ltv: 0.75,
    stage,
    dbr: 0.4,
    bank_options: [bank()],
    expected_commission: 10_125,
    valuation_status: 'not_requested',
    valuation_requested_date: null,
    stage_history: [{ stage, entered_at: daysBefore(dwell) }],
    assigned_rm: 'Aisha Rahman',
    source_channel: 'organic',
    pre_approval_date: daysBefore(10),
    payment_milestones: null,
    handover_date: null,
    activities: [
      { date: daysBefore(4), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
      { date: daysBefore(6), direction: 'outbound', channel: 'whatsapp', type: 'follow_up' },
    ],
    docs_outstanding: 0,
    services_attached: [],
    transfer_type: null,
    ...overrides,
  };
}

// Generous benchmarks so VELOCITY_STALL doesn't fire unless a test sets it low.
const HIGH_BENCH: Record<string, number> = {
  lead: 999,
  pre_approval: 999,
  property_found: 999,
  application: 999,
  valuation: 999,
  final_offer: 999,
  signed: 999,
  disbursed: 999,
};

const codes = (c: Case, bench = HIGH_BENCH) =>
  riskFlags(c, bench, NOW).map((f) => f.code);

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

describe('date + decay helpers', () => {
  it('workingDaysSince counts weekdays only', () => {
    // 2026-07-06 is a Monday; 10 working days back to 2026-07-20 (a Monday).
    expect(workingDaysSince('2026-07-06', NOW)).toBe(10);
  });

  it('stalenessDecay thresholds', () => {
    expect(stalenessDecay(0)).toBe(1.0);
    expect(stalenessDecay(6)).toBe(1.0);
    expect(stalenessDecay(7)).toBe(0.7);
    expect(stalenessDecay(13)).toBe(0.7);
    expect(stalenessDecay(29)).toBe(0.4);
    expect(stalenessDecay(30)).toBe(0.2);
    expect(stalenessDecay(null)).toBe(0.2);
  });
});

// --------------------------------------------------------------------------- //
// Priority score
// --------------------------------------------------------------------------- //

describe('priorityScore', () => {
  it('multiplies commission x stage probability x staleness decay', () => {
    const c = makeCase({ stage: 'valuation', expected_commission: 10_000 });
    const p = priorityScore(c, NOW);
    // valuation 0.65, last activity 4 days ago -> decay 1.0
    expect(p.stageProbability).toBe(0.65);
    expect(p.stalenessDecay).toBe(1.0);
    expect(p.score).toBeCloseTo(10_000 * 0.65 * 1.0);
    expect(p.humanReadableReason).toContain('AED');
  });

  it('applies decay when the case is cold', () => {
    const c = makeCase({
      activities: [
        { date: daysBefore(40), direction: 'inbound', channel: 'call', type: 'reply' },
      ],
    });
    expect(priorityScore(c, NOW).stalenessDecay).toBe(0.2);
  });
});

// --------------------------------------------------------------------------- //
// Healthy baseline
// --------------------------------------------------------------------------- //

describe('healthy baseline', () => {
  it('raises no flags and classifies HEALTHY', () => {
    const c = makeCase();
    expect(codes(c)).toEqual([]);
    expect(classify(c, HIGH_BENCH, NOW).classification).toBe('HEALTHY');
  });
});

// --------------------------------------------------------------------------- //
// Risk flags — each fires on a crafted case
// --------------------------------------------------------------------------- //

describe('risk flags', () => {
  it('VELOCITY_STALL never fires on the terminal disbursed stage', () => {
    const c = makeCase({
      stage: 'disbursed',
      transfer_type: 'one_bank',
      services_attached: ['life_insurance'],
      stage_history: [{ stage: 'disbursed', entered_at: daysBefore(40) }],
    });
    const bench = { ...HIGH_BENCH, disbursed: 9 }; // dwell 40 >> 9, but stage is terminal
    expect(codes(c, bench)).not.toContain('VELOCITY_STALL');
    expect(classify(c, bench, NOW).classification).toBe('HEALTHY');
  });

  it('VELOCITY_STALL fires when dwell exceeds the benchmark', () => {
    const c = makeCase({
      stage: 'valuation',
      stage_history: [{ stage: 'valuation', entered_at: daysBefore(14) }],
    });
    const bench = { ...HIGH_BENCH, valuation: 9 };
    expect(codes(c, bench)).toContain('VELOCITY_STALL');
    // reason uses "typical", never "p75"
    const f = riskFlags(c, bench, NOW).find((x) => x.code === 'VELOCITY_STALL')!;
    expect(f.humanReadableReason).toContain('typical is 9');
    expect(f.humanReadableReason).not.toContain('p75');
  });

  it('PAYMENT_CLIFF fires for offplan milestone due soon with a silent client', () => {
    const c = makeCase({
      property_type: 'offplan',
      handover_date: daysAfter(400),
      payment_milestones: [{ due_date: daysAfter(12), amount: 120_000 }],
      activities: [
        { date: daysBefore(12), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
        { date: daysBefore(3), direction: 'outbound', channel: 'call', type: 'reminder' },
      ],
    });
    expect(codes(c)).toContain('PAYMENT_CLIFF');
  });

  it('PAYMENT_CLIFF does NOT fire when the client replied recently', () => {
    const c = makeCase({
      property_type: 'offplan',
      handover_date: daysAfter(400),
      payment_milestones: [{ due_date: daysAfter(12), amount: 120_000 }],
      activities: [
        { date: daysBefore(2), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
      ],
    });
    expect(codes(c)).not.toContain('PAYMENT_CLIFF');
  });

  it('PRE_APPROVAL_EXPIRY fires within 14 days before final_offer', () => {
    const c = makeCase({
      stage: 'property_found',
      stage_history: [{ stage: 'property_found', entered_at: daysBefore(5) }],
      pre_approval_date: daysBefore(50), // expires in 10 days
    });
    expect(codes(c)).toContain('PRE_APPROVAL_EXPIRY');
  });

  it('PRE_APPROVAL_EXPIRY does NOT fire once at/after final_offer', () => {
    const c = makeCase({
      stage: 'final_offer',
      stage_history: [{ stage: 'final_offer', entered_at: daysBefore(5) }],
      pre_approval_date: daysBefore(50),
    });
    expect(codes(c)).not.toContain('PRE_APPROVAL_EXPIRY');
  });

  it('TRANSFER_TUNNEL fires for a silent two-bank signed case past 45 days', () => {
    const c = makeCase({
      stage: 'signed',
      transfer_type: 'two_bank',
      stage_history: [{ stage: 'signed', entered_at: daysBefore(52) }],
      activities: [
        { date: daysBefore(25), direction: 'inbound', channel: 'email', type: 'query' },
        { date: daysBefore(4), direction: 'outbound', channel: 'whatsapp', type: 'status' },
      ],
      services_attached: ['life_insurance'],
    });
    expect(codes(c)).toContain('TRANSFER_TUNNEL');
  });

  it('GONE_QUIET fires with 3+ outbound and no inbound in 10 days', () => {
    const c = makeCase({
      activities: [
        { date: daysBefore(9), direction: 'outbound', channel: 'call', type: 'follow_up' },
        { date: daysBefore(5), direction: 'outbound', channel: 'whatsapp', type: 'follow_up' },
        { date: daysBefore(2), direction: 'outbound', channel: 'email', type: 'follow_up' },
        { date: daysBefore(20), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
      ],
    });
    expect(codes(c)).toContain('GONE_QUIET');
  });

  it('VALUATION_OVERDUE fires past the 5 working-day SLA', () => {
    const c = makeCase({
      stage: 'valuation',
      stage_history: [{ stage: 'valuation', entered_at: daysBefore(12) }],
      valuation_status: 'requested',
      valuation_requested_date: daysBefore(12), // ~8 working days
    });
    expect(codes(c)).toContain('VALUATION_OVERDUE');
  });

  it('VALUATION_OVERDUE does NOT fire when recently requested', () => {
    const c = makeCase({
      stage: 'valuation',
      stage_history: [{ stage: 'valuation', entered_at: daysBefore(3) }],
      valuation_status: 'requested',
      valuation_requested_date: daysBefore(2),
    });
    expect(codes(c)).not.toContain('VALUATION_OVERDUE');
  });

  it('DOCS_STUCK fires with 2+ docs and no doc activity in 5+ days', () => {
    const c = makeCase({
      stage: 'application',
      docs_outstanding: 3,
      activities: [
        { date: daysBefore(9), direction: 'outbound', channel: 'email', type: 'doc_request' },
        { date: daysBefore(2), direction: 'inbound', channel: 'whatsapp', type: 'question' },
      ],
    });
    expect(codes(c)).toContain('DOCS_STUCK');
  });

  it('DOCS_STUCK does NOT fire when docs were touched recently', () => {
    const c = makeCase({
      stage: 'application',
      docs_outstanding: 3,
      activities: [
        { date: daysBefore(2), direction: 'inbound', channel: 'whatsapp', type: 'doc_upload' },
      ],
    });
    expect(codes(c)).not.toContain('DOCS_STUCK');
  });
});

// --------------------------------------------------------------------------- //
// Classifier
// --------------------------------------------------------------------------- //

describe('classifier', () => {
  it('STALLED: flagged but a recent inbound keeps it recoverable', () => {
    const c = makeCase({
      stage: 'valuation',
      stage_history: [{ stage: 'valuation', entered_at: daysBefore(14) }],
      activities: [
        { date: daysBefore(6), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
        { date: daysBefore(2), direction: 'outbound', channel: 'call', type: 'follow_up' },
      ],
    });
    const bench = { ...HIGH_BENCH, valuation: 9 };
    const r = classify(c, bench, NOW);
    expect(r.classification).toBe('STALLED');
    expect(r.recommendedAction).toMatch(/call|nudge/i);
  });

  it('RATIONAL_PAUSE: flagged, no inbound since valuation, dwell > 21', () => {
    const c = makeCase({
      stage: 'final_offer',
      stage_history: [
        { stage: 'valuation', entered_at: daysBefore(40) },
        { stage: 'final_offer', entered_at: daysBefore(30) },
      ],
      activities: [
        { date: daysBefore(45), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
        { date: daysBefore(6), direction: 'outbound', channel: 'whatsapp', type: 'nudge' },
      ],
    });
    const bench = { ...HIGH_BENCH, final_offer: 9 };
    const r = classify(c, bench, NOW);
    expect(r.classification).toBe('RATIONAL_PAUSE');
    expect(r.pauseKind).toBe('customer_paused');
    expect(r.recommendedAction).toMatch(/nurture/i);
  });

  it('HEALTHY when no flag fires even if quiet', () => {
    const c = makeCase({
      activities: [
        { date: daysBefore(40), direction: 'inbound', channel: 'call', type: 'reply' },
      ],
    });
    expect(classify(c, HIGH_BENCH, NOW).classification).toBe('HEALTHY');
  });

  // Eval-driven fix #1: an early-warning flag is not a stall. A slow valuer or a
  // looming deadline while the client is still replying must NOT read as STALLED.
  it('HEALTHY (not STALLED) when only an early-warning flag fires', () => {
    const c = makeCase({
      stage: 'valuation',
      stage_history: [{ stage: 'valuation', entered_at: daysBefore(12) }],
      valuation_status: 'requested',
      valuation_requested_date: daysBefore(12), // VALUATION_OVERDUE
      activities: [
        { date: daysBefore(6), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
      ],
    });
    expect(codes(c)).toContain('VALUATION_OVERDUE');
    const r = classify(c, HIGH_BENCH, NOW);
    expect(r.classification).toBe('HEALTHY');
    expect(r.humanReadableReason).toMatch(/not stalled/i);
  });

  // Eval-driven fix #2: a silent transfer-tunnel case is a pause, and the action
  // must chase the process rather than nurture the customer.
  it('RATIONAL_PAUSE (process_blocked) for a silent transfer-tunnel case', () => {
    const c = makeCase({
      stage: 'signed',
      transfer_type: 'two_bank',
      stage_history: [
        { stage: 'valuation', entered_at: daysBefore(90) },
        { stage: 'signed', entered_at: daysBefore(52) },
      ],
      services_attached: ['life_insurance', 'conveyancing'],
      activities: [
        { date: daysBefore(25), direction: 'inbound', channel: 'email', type: 'query' },
        { date: daysBefore(4), direction: 'outbound', channel: 'whatsapp', type: 'status' },
      ],
    });
    const r = classify(c, HIGH_BENCH, NOW);
    expect(r.classification).toBe('RATIONAL_PAUSE');
    expect(r.pauseKind).toBe('process_blocked');
    expect(r.recommendedAction).toMatch(/bank|conveyancer/i);
    expect(r.recommendedAction).toMatch(/not nurture/i);
    expect(r.humanReadableReason).toMatch(/process is blocked/i);
    // process-blocked pauses get no nurture track, but cross-sell is still held
    const analysis = analyzeCase(c, HIGH_BENCH, NOW);
    expect(analysis.nurtureTrack).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// Cross-sell triggers
// --------------------------------------------------------------------------- //

describe('cross-sell triggers', () => {
  const trigCodes = (c: Case) => crossSellTriggers(c, NOW).map((t) => t.code);

  it('CONVEYANCING_ATTACH at/after final_offer without conveyancing', () => {
    const c = makeCase({
      stage: 'final_offer',
      stage_history: [{ stage: 'final_offer', entered_at: daysBefore(7) }],
      services_attached: [],
    });
    expect(trigCodes(c)).toContain('CONVEYANCING_ATTACH');
  });

  it('LIFE_INSURANCE_GAP when signed without life insurance', () => {
    const c = makeCase({
      stage: 'signed',
      stage_history: [{ stage: 'signed', entered_at: daysBefore(5) }],
      transfer_type: 'one_bank',
      services_attached: ['conveyancing'],
    });
    expect(trigCodes(c)).toContain('LIFE_INSURANCE_GAP');
  });

  it('HANDOVER_PIPELINE for offplan handover within 180 days', () => {
    const c = makeCase({
      stage: 'pre_approval',
      stage_history: [{ stage: 'pre_approval', entered_at: daysBefore(5) }],
      property_type: 'offplan',
      handover_date: daysAfter(120),
      payment_milestones: [{ due_date: daysAfter(300), amount: 100_000 }],
    });
    expect(trigCodes(c)).toContain('HANDOVER_PIPELINE');
  });
});

// --------------------------------------------------------------------------- //
// Suppression rule
// --------------------------------------------------------------------------- //

describe('rational-pause suppression', () => {
  it('suppresses cross-sell triggers and assigns a nurture track', () => {
    const c = makeCase({
      stage: 'final_offer',
      purpose: 'investment',
      stage_history: [
        { stage: 'valuation', entered_at: daysBefore(40) },
        { stage: 'final_offer', entered_at: daysBefore(30) },
      ],
      services_attached: [], // would trigger CONVEYANCING_ATTACH
      activities: [
        { date: daysBefore(45), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
        { date: daysBefore(6), direction: 'outbound', channel: 'whatsapp', type: 'nudge' },
      ],
    });
    const bench = { ...HIGH_BENCH, final_offer: 9 };
    const analysis = analyzeCase(c, bench, NOW);
    expect(analysis.classification.classification).toBe('RATIONAL_PAUSE');
    expect(analysis.crossSell.length).toBeGreaterThan(0);
    expect(analysis.crossSell.every((t) => t.suppressed)).toBe(true);
    expect(analysis.nurtureTrack?.track).toBe('rate_yield_watch');
  });

  it('does not suppress for a STALLED case', () => {
    const c = makeCase({
      stage: 'final_offer',
      stage_history: [{ stage: 'final_offer', entered_at: daysBefore(14) }],
      services_attached: [],
      activities: [
        { date: daysBefore(5), direction: 'inbound', channel: 'whatsapp', type: 'reply' },
      ],
    });
    const bench = { ...HIGH_BENCH, final_offer: 9 };
    const analysis = analyzeCase(c, bench, NOW);
    expect(analysis.classification.classification).toBe('STALLED');
    expect(analysis.crossSell.some((t) => t.suppressed)).toBe(false);
    expect(analysis.nurtureTrack).toBeNull();
  });
});

// --------------------------------------------------------------------------- //
// Bank selection intelligence
// --------------------------------------------------------------------------- //

describe('bankAnalysis', () => {
  it('recommends a switch only within the 0.10% rate guardrail', () => {
    const c = makeCase({
      loan_amount: 1_000_000,
      bank_options: [
        bank({ bank_name: 'Bank A', rate: 4.2, commission_pct: 0.006, approval_probability: 0.8, selected: true }),
        bank({ bank_name: 'Bank B', rate: 4.25, commission_pct: 0.009, approval_probability: 0.85, selected: false }),
      ],
    });
    const b = bankAnalysis(c);
    // Bank B: 1,000,000 * 0.009 * 0.85 = 7,650 > Bank A 4,800, rate within 0.10%
    expect(b.revenueOptimal.bank_name).toBe('Bank B');
    expect(b.recommendSwitch).toBe(true);
    expect(b.switchReason).toContain('within 0.10%');
  });

  it('does not recommend a switch that breaks the rate guardrail', () => {
    const c = makeCase({
      loan_amount: 1_000_000,
      bank_options: [
        bank({ bank_name: 'Bank A', rate: 4.2, commission_pct: 0.006, approval_probability: 0.8, selected: true }),
        bank({ bank_name: 'Bank B', rate: 4.6, commission_pct: 0.012, approval_probability: 0.9, selected: false }),
      ],
    });
    const b = bankAnalysis(c);
    expect(b.revenueOptimal.bank_name).toBe('Bank B');
    expect(b.recommendSwitch).toBe(false); // 0.40% rate jump exceeds guardrail
  });

  it('flags a DBR conflict when the selected bank does not fit but another does', () => {
    const c = makeCase({
      dbr: 0.47,
      bank_options: [
        bank({ bank_name: 'Tight Bank', dbr_limit: 0.45, selected: true }),
        bank({ bank_name: 'Roomy Bank', dbr_limit: 0.5, selected: false }),
      ],
    });
    const b = bankAnalysis(c);
    expect(b.dbrConflict).toBe(true);
    expect(b.dbrConflictReason).toContain('Tight Bank');
    expect(b.dbrConflictReason).toContain('Roomy Bank');
  });
});

// --------------------------------------------------------------------------- //
// Benchmarks
// --------------------------------------------------------------------------- //

describe('computeStageBenchmarks', () => {
  it('computes a p75 dwell per stage from the book', () => {
    const cases = [4, 6, 8, 20].map((d, i) =>
      makeCase({
        id: `HOL-${i}`,
        stage: 'valuation',
        stage_history: [{ stage: 'valuation', entered_at: daysBefore(d) }],
      })
    );
    const bench = computeStageBenchmarks(cases, NOW);
    // ceil(0.75*4)-1 = index 2 of [4,6,8,20] -> 8
    expect(bench.valuation).toBe(8);
    expect(currentDwell(cases[3], NOW)).toBe(20);
  });
});
