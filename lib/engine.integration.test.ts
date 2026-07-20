// Parity guard: the TypeScript engine must agree with the Python generator's
// detectors on the committed book. If either side's rules drift, this fails.
// Expected counts come from `py scripts/generate_cases.py` (seed 42, anchor 2026-07-20).

import { describe, it, expect } from 'vitest';
import cases from '../data/cases.json';
import {
  Case,
  computeStageBenchmarks,
  riskFlags,
  crossSellTriggers,
  classify,
  REFERENCE_DATE,
} from './engine';

const book = cases as unknown as Case[];
const bench = computeStageBenchmarks(book, REFERENCE_DATE);

function countFlag(code: string): number {
  return book.filter((c) => riskFlags(c, bench, REFERENCE_DATE).some((f) => f.code === code)).length;
}
function countTrigger(code: string): number {
  return book.filter((c) => crossSellTriggers(c, REFERENCE_DATE).some((t) => t.code === code)).length;
}
function countClass(cls: string): number {
  return book.filter((c) => classify(c, bench, REFERENCE_DATE).classification === cls).length;
}

describe('engine <-> generator parity on data/cases.json', () => {
  it('has the full 400-case book', () => {
    expect(book.length).toBe(400);
  });

  it('risk-flag counts match the generator', () => {
    expect(countFlag('GONE_QUIET')).toBe(15);
    expect(countFlag('PAYMENT_CLIFF')).toBe(15);
    expect(countFlag('PRE_APPROVAL_EXPIRY')).toBe(10);
    expect(countFlag('TRANSFER_TUNNEL')).toBe(12);
    expect(countFlag('VALUATION_OVERDUE')).toBe(15);
    expect(countFlag('DOCS_STUCK')).toBe(10);
    expect(countFlag('VELOCITY_STALL')).toBe(71); // excludes terminal 'disbursed'
  });

  it('cross-sell trigger counts match the generator', () => {
    expect(countTrigger('LIFE_INSURANCE_GAP')).toBe(20);
    expect(countTrigger('HANDOVER_PIPELINE')).toBe(8);
    expect(countTrigger('CONVEYANCING_ATTACH')).toBe(31); // excludes funded 'disbursed'
  });

  it('classifier distribution matches the generator', () => {
    // Post-eval tuning: stall-flag gate + relaxed pause (see data/eval_results.json).
    // Terminal 'disbursed' no longer velocity-stalls, so 8 funded cases are HEALTHY.
    expect(countClass('STALLED')).toBe(60);
    expect(countClass('RATIONAL_PAUSE')).toBe(22);
    expect(countClass('HEALTHY')).toBe(318);
  });
});
