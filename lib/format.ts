// Presentation helpers — pure, dependency-free, safe in both server and client components.

import type { Stage } from './engine';

/** AED with thousands separators, e.g. "AED 1,872,000". */
export function aed(n: number): string {
  return `AED ${Math.round(n).toLocaleString('en-US')}`;
}

/** Compact AED for large headline figures, e.g. "AED 1.87M". */
export function aedShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `AED ${Math.round(n / 1000)}K`;
  return `AED ${Math.round(n).toLocaleString('en-US')}`;
}

/** Whole-number percent from a 0–1 fraction. */
export function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Friendly, human stage names (never the raw code). */
export const STAGE_LABELS: Record<Stage, string> = {
  lead: 'Lead',
  pre_approval: 'Pre-approval',
  property_found: 'Property search',
  application: 'Application',
  valuation: 'Valuation',
  final_offer: 'Final offer',
  signed: 'Signing',
  disbursed: 'Disbursed',
};

export const STAGE_ORDER: Stage[] = [
  'lead',
  'pre_approval',
  'property_found',
  'application',
  'valuation',
  'final_offer',
  'signed',
  'disbursed',
];

export function titleCase(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
