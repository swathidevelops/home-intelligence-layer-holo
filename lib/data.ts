// Server-only data layer. Reads the committed JSON files, runs the rules engine
// once at build time, and produces small serializable view models for the pages.
// The deployed app never calls any API — everything here is static.

import casesJson from '@/data/cases.json';
import briefsJson from '@/data/ai_briefs.json';
import evalJson from '@/data/eval_results.json';
import {
  Case,
  Stage,
  RiskFlagCode,
  analyzeCase,
  computeStageBenchmarks,
  REFERENCE_DATE,
} from '@/lib/engine';
import { STAGE_ORDER } from '@/lib/format';

// --------------------------------------------------------------------------- //
// Raw inputs
// --------------------------------------------------------------------------- //

const cases = casesJson as unknown as Case[];
const benchmarks = computeStageBenchmarks(cases, REFERENCE_DATE);

export interface Brief {
  case_id: string;
  classification: string;
  pause_kind: string | null;
  recommended_action: string;
  brief: string;
  whatsapp: string;
}
const briefsById = new Map<string, Brief>(
  (briefsJson as unknown as Brief[]).map((b) => [b.case_id, b]),
);

export const evalResults = evalJson as unknown as EvalResults;

// --------------------------------------------------------------------------- //
// View models
// --------------------------------------------------------------------------- //

export interface Chip {
  code: string; // internal only — used for colour, never rendered
  label: string;
  reason: string;
  framing?: string;
  suppressed?: boolean;
}

export interface BankVM {
  bank_name: string;
  rate: number;
  commission_pct: number;
  approval_probability: number;
  avg_days_to_fund: number;
  dbr_limit: number;
  selected: boolean;
  expected_funded_revenue: number;
  fits_dbr: boolean;
}

export interface CaseVM {
  id: string;
  clientName: string;
  stage: Stage;
  segment: string;
  residency: string;
  purpose: string;
  propertyType: string;
  rm: string;
  sourceChannel: string;
  // money
  expectedCommission: number;
  loanAmount: number;
  propertyPrice: number;
  ltv: number;
  dbr: number;
  // engine
  priorityScore: number;
  priorityReason: string;
  stageProbability: number;
  stalenessDecay: number;
  daysSinceLastActivity: number | null;
  classification: string;
  pauseKind: string | null;
  classificationReason: string;
  recommendedAction: string;
  primaryReason: string;
  riskChips: Chip[];
  crossSellChips: Chip[];
  nurture: { track: string; reason: string } | null;
  bank: {
    banks: BankVM[];
    selectedName: string;
    optimalName: string;
    recommendSwitch: boolean;
    switchReason: string | null;
    dbrConflict: boolean;
    dbrConflictReason: string | null;
    fairnessGuardrailNote: string;
    payoutNote: string;
  };
  brief: { brief: string; whatsapp: string } | null;
}

function toVM(c: Case): CaseVM {
  const a = analyzeCase(c, benchmarks, REFERENCE_DATE);
  const riskChips: Chip[] = a.flags.map((f) => ({
    code: f.code,
    label: f.label,
    reason: f.humanReadableReason,
  }));
  const crossSellChips: Chip[] = a.crossSell.map((t) => ({
    code: t.code,
    label: t.label,
    reason: t.humanReadableReason,
    framing: t.framing,
    suppressed: t.suppressed,
  }));
  const brief = briefsById.get(c.id);

  return {
    id: c.id,
    clientName: c.client_name,
    stage: c.stage,
    segment: c.segment,
    residency: c.residency,
    purpose: c.purpose,
    propertyType: c.property_type,
    rm: c.assigned_rm,
    sourceChannel: c.source_channel,
    expectedCommission: c.expected_commission,
    loanAmount: c.loan_amount,
    propertyPrice: c.property_price,
    ltv: c.ltv,
    dbr: c.dbr,
    priorityScore: a.priority.score,
    priorityReason: a.priority.humanReadableReason,
    stageProbability: a.priority.stageProbability,
    stalenessDecay: a.priority.stalenessDecay,
    daysSinceLastActivity: a.priority.daysSinceLastActivity,
    classification: a.classification.classification,
    pauseKind: a.classification.pauseKind,
    classificationReason: a.classification.humanReadableReason,
    recommendedAction: a.classification.recommendedAction,
    primaryReason:
      riskChips[0]?.reason ??
      crossSellChips[0]?.reason ??
      a.classification.humanReadableReason,
    riskChips,
    crossSellChips,
    nurture: a.nurtureTrack
      ? { track: a.nurtureTrack.track, reason: a.nurtureTrack.humanReadableReason }
      : null,
    bank: {
      banks: a.bank.banks.map((b) => ({
        bank_name: b.bank_name,
        rate: b.rate,
        commission_pct: b.commission_pct,
        approval_probability: b.approval_probability,
        avg_days_to_fund: b.avg_days_to_fund,
        dbr_limit: b.dbr_limit,
        selected: b.selected,
        expected_funded_revenue: b.expected_funded_revenue,
        fits_dbr: b.fits_dbr,
      })),
      selectedName: a.bank.selected.bank_name,
      optimalName: a.bank.revenueOptimal.bank_name,
      recommendSwitch: a.bank.recommendSwitch,
      switchReason: a.bank.switchReason,
      dbrConflict: a.bank.dbrConflict,
      dbrConflictReason: a.bank.dbrConflictReason,
      fairnessGuardrailNote: a.bank.fairnessGuardrailNote,
      payoutNote: a.bank.payoutNote,
    },
    brief: brief ? { brief: brief.brief, whatsapp: brief.whatsapp } : null,
  };
}

const allVMs: CaseVM[] = cases.map(toVM);

// --------------------------------------------------------------------------- //
// Case Manager queries
// --------------------------------------------------------------------------- //

export const RMS: string[] = Array.from(new Set(cases.map((c) => c.assigned_rm))).sort();

/** An RM's action queue: cases carrying a flag or a cross-sell, ranked by priority. */
export function actionQueue(rm: string, limit = 10): CaseVM[] {
  return allVMs
    .filter((v) => v.rm === rm && (v.riskChips.length > 0 || v.crossSellChips.length > 0))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

export function rmStats(rm: string) {
  const mine = allVMs.filter((v) => v.rm === rm);
  const actionable = mine.filter(
    (v) => v.riskChips.length > 0 || v.crossSellChips.length > 0,
  );
  const atRiskCommission = mine
    .filter((v) => v.riskChips.length > 0)
    .reduce((s, v) => s + v.expectedCommission, 0);
  return { total: mine.length, actionable: actionable.length, atRiskCommission };
}

// --------------------------------------------------------------------------- //
// Leadership aggregates
// --------------------------------------------------------------------------- //

export interface EvalResults {
  generated_at: string;
  reference_date: string;
  classifier: {
    n: number;
    accuracy: number;
    classes: string[];
    confusion_matrix: number[][];
    confusion_matrix_orientation: string;
    per_class: Record<
      string,
      { precision: number; recall: number; f1: number; support: number }
    >;
    macro_avg: { precision: number; recall: number; f1: number };
    disagreements: Array<{
      id: string;
      stage: string;
      gold_label: string;
      predicted: string;
    }>;
  };
  llm_briefs:
    | { status: 'not_run'; reason: string; checks: string[] }
    | {
        status: 'run';
        n: number;
        passed: number;
        pass_rate: number;
        checks: string[];
        results: Array<{ id: string; passed: boolean; failures: string[] }>;
      };
}

// Which flag "owns" an at-risk case for the reason breakdown (most severe first).
const REASON_PRIORITY: RiskFlagCode[] = [
  'TRANSFER_TUNNEL',
  'VALUATION_OVERDUE',
  'PAYMENT_CLIFF',
  'PRE_APPROVAL_EXPIRY',
  'DOCS_STUCK',
  'GONE_QUIET',
  'VELOCITY_STALL',
];
const REASON_LABELS: Record<RiskFlagCode, string> = {
  TRANSFER_TUNNEL: 'Transfer tunnel',
  VALUATION_OVERDUE: 'Valuation delay',
  PAYMENT_CLIFF: 'Payment cliff',
  PRE_APPROVAL_EXPIRY: 'Pre-approval expiry',
  DOCS_STUCK: 'Docs stuck',
  GONE_QUIET: 'Client silent',
  VELOCITY_STALL: 'Stuck in stage',
};

export interface LeadershipData {
  atRiskTotal: number;
  atRiskCount: number;
  reasonBreakdown: { reason: string; count: number; commission: number }[];
  revenueByStage: { stage: string; commission: number; count: number }[];
  funnel: { stage: string; reached: number; current: number }[];
  attachment: { service: string; attached: number; eligible: number; rate: number }[];
  handover: { count: number; futureCommission: number };
  banks: {
    bank: string;
    inFunnel: number;
    avgDaysToFund: number;
    avgCommissionPct: number;
    totalCommission: number;
  }[];
  totals: { cases: number; classified: Record<string, number> };
}

export function leadershipData(): LeadershipData {
  const flagged = allVMs.filter((v) => v.riskChips.length > 0);
  const atRiskTotal = flagged.reduce((s, v) => s + v.expectedCommission, 0);

  // Reason breakdown — attribute each at-risk case to its single most severe flag.
  const reasonMap = new Map<string, { count: number; commission: number }>();
  for (const v of flagged) {
    const codes = new Set(v.riskChips.map((c) => c.code));
    const primary = REASON_PRIORITY.find((code) => codes.has(code)) ?? 'VELOCITY_STALL';
    const label = REASON_LABELS[primary];
    const cur = reasonMap.get(label) ?? { count: 0, commission: 0 };
    cur.count += 1;
    cur.commission += v.expectedCommission;
    reasonMap.set(label, cur);
  }
  const reasonBreakdown = Array.from(reasonMap.entries())
    .map(([reason, x]) => ({ reason, ...x }))
    .sort((a, b) => b.commission - a.commission);

  // Revenue at risk by stage.
  const revenueByStage = STAGE_ORDER.map((stage) => {
    const inStage = flagged.filter((v) => v.stage === stage);
    return {
      stage,
      commission: inStage.reduce((s, v) => s + v.expectedCommission, 0),
      count: inStage.length,
    };
  }).filter((x) => x.count > 0);

  // Funnel — how many cases ever reached each stage (from stage_history) vs sit there now.
  const reachedCount = new Map<string, number>();
  const currentCount = new Map<string, number>();
  for (const c of cases) {
    currentCount.set(c.stage, (currentCount.get(c.stage) ?? 0) + 1);
    for (const h of c.stage_history) {
      reachedCount.set(h.stage, (reachedCount.get(h.stage) ?? 0) + 1);
    }
  }
  const funnel = STAGE_ORDER.map((stage) => ({
    stage,
    reached: reachedCount.get(stage) ?? 0,
    current: currentCount.get(stage) ?? 0,
  }));

  // Cross-sell attachment rates.
  const stageIndex = (s: Stage) => STAGE_ORDER.indexOf(s);
  const attachment = [
    {
      service: 'Conveyancing',
      eligibleFn: (c: Case) => stageIndex(c.stage) >= stageIndex('final_offer'),
      key: 'conveyancing',
    },
    {
      service: 'Life insurance',
      eligibleFn: (c: Case) => stageIndex(c.stage) >= stageIndex('signed'),
      key: 'life_insurance',
    },
    {
      service: 'Home insurance',
      eligibleFn: (c: Case) => stageIndex(c.stage) >= stageIndex('signed'),
      key: 'home_insurance',
    },
    {
      service: 'Concierge',
      eligibleFn: (_c: Case) => true,
      key: 'concierge',
    },
  ].map(({ service, eligibleFn, key }) => {
    const eligible = cases.filter(eligibleFn);
    const attached = eligible.filter((c) => c.services_attached.includes(key)).length;
    return {
      service,
      attached,
      eligible: eligible.length,
      rate: eligible.length ? attached / eligible.length : 0,
    };
  });

  // Handover pipeline.
  const handoverCases = allVMs.filter((v) =>
    v.crossSellChips.some((c) => c.code === 'HANDOVER_PIPELINE'),
  );
  const handover = {
    count: handoverCases.length,
    futureCommission: handoverCases.reduce((s, v) => s + v.expectedCommission, 0),
  };

  // Bank performance snapshot (by each case's selected bank).
  const bankMap = new Map<
    string,
    { count: number; days: number; commPct: number; commission: number }
  >();
  for (const c of cases) {
    const sel = c.bank_options.find((b) => b.selected);
    if (!sel) continue;
    const cur = bankMap.get(sel.bank_name) ?? { count: 0, days: 0, commPct: 0, commission: 0 };
    cur.count += 1;
    cur.days += sel.avg_days_to_fund;
    cur.commPct += sel.commission_pct;
    cur.commission += c.expected_commission;
    bankMap.set(sel.bank_name, cur);
  }
  const banks = Array.from(bankMap.entries())
    .map(([bank, x]) => ({
      bank,
      inFunnel: x.count,
      avgDaysToFund: Math.round(x.days / x.count),
      avgCommissionPct: x.commPct / x.count,
      totalCommission: x.commission,
    }))
    .sort((a, b) => b.totalCommission - a.totalCommission);

  const classified: Record<string, number> = {};
  for (const v of allVMs) {
    classified[v.classification] = (classified[v.classification] ?? 0) + 1;
  }

  return {
    atRiskTotal,
    atRiskCount: flagged.length,
    reasonBreakdown,
    revenueByStage,
    funnel,
    attachment,
    handover,
    banks,
    totals: { cases: cases.length, classified },
  };
}
