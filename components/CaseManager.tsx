'use client';

import { useState } from 'react';
import type { CaseVM, Chip } from '@/lib/data';
import { aed, pct, STAGE_LABELS, titleCase } from '@/lib/format';

interface Props {
  rms: string[];
  queues: Record<string, CaseVM[]>;
  stats: Record<string, { total: number; actionable: number; atRiskCommission: number }>;
  hasBriefs: boolean;
}

const EARLY_WARNING = new Set(['PRE_APPROVAL_EXPIRY', 'PAYMENT_CLIFF', 'VALUATION_OVERDUE']);

function chipClass(chip: Chip): string {
  if (chip.suppressed) return 'bg-slate-100 text-slate-400 line-through decoration-slate-300';
  if (chip.code.startsWith('__cross')) return 'bg-accent/10 text-accent';
  // cross-sell codes
  if (['CONVEYANCING_ATTACH', 'LIFE_INSURANCE_GAP', 'HANDOVER_PIPELINE'].includes(chip.code))
    return 'bg-accent/10 text-accent';
  if (EARLY_WARNING.has(chip.code)) return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-700'; // stall-detection flags
}

function Badge({ vm }: { vm: CaseVM }) {
  if (vm.classification === 'STALLED')
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        Stalled
      </span>
    );
  if (vm.classification === 'RATIONAL_PAUSE')
    return (
      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">
        Rational pause{vm.pauseKind === 'process_blocked' ? ' · process' : ' · client'}
      </span>
    );
  if (vm.riskChips.length > 0)
    return (
      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
        Early warning
      </span>
    );
  return (
    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
      Opportunity
    </span>
  );
}

function ChipRow({ chips }: { chips: Chip[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span
          key={i}
          title={c.reason}
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${chipClass(c)}`}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

function BankCard({ vm }: { vm: CaseVM }) {
  const b = vm.bank;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
        Bank fit &amp; funded-revenue optimisation
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="px-3 py-1.5 font-medium">Bank</th>
              <th className="px-3 py-1.5 font-medium">Rate</th>
              <th className="px-3 py-1.5 font-medium">Comm.</th>
              <th className="px-3 py-1.5 font-medium" title="Static per-segment assumption, not a prediction">
                Approval (assumption)
              </th>
              <th className="px-3 py-1.5 font-medium">Days to fund</th>
              <th className="px-3 py-1.5 font-medium">DBR fit</th>
              <th className="px-3 py-1.5 text-right font-medium">Exp. funded revenue</th>
            </tr>
          </thead>
          <tbody>
            {b.banks.map((row) => (
              <tr
                key={row.bank_name}
                className={`border-t border-slate-100 ${
                  row.selected ? 'bg-accent/5' : ''
                }`}
              >
                <td className="px-3 py-1.5 font-medium text-slate-800">
                  {row.bank_name}
                  {row.selected && (
                    <span className="ml-1.5 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent">
                      selected
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-600">{row.rate.toFixed(2)}%</td>
                <td className="px-3 py-1.5 text-slate-600">
                  {(row.commission_pct * 100).toFixed(2)}%
                </td>
                <td className="px-3 py-1.5 text-slate-600">{pct(row.approval_probability)}</td>
                <td className="px-3 py-1.5 text-slate-600">{row.avg_days_to_fund}d</td>
                <td className="px-3 py-1.5">
                  {row.fits_dbr ? (
                    <span className="text-emerald-600">fits</span>
                  ) : (
                    <span className="text-rose-600">exceeds</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">
                  {aed(row.expected_funded_revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 px-3 py-2 text-xs">
        {b.dbrConflict && (
          <p className="font-medium text-rose-700">⚠ {b.dbrConflictReason}</p>
        )}
        {b.recommendSwitch ? (
          <p className="font-medium text-accent">→ {b.switchReason}</p>
        ) : (
          <p className="text-slate-500">
            Selected bank is the revenue-optimal choice within the fairness guardrail.
          </p>
        )}
        <p className="text-slate-500">{b.payoutNote}</p>
        <p className="text-slate-400">{b.fairnessGuardrailNote}</p>
      </div>
    </div>
  );
}

function Detail({ vm, hasBriefs }: { vm: CaseVM; hasBriefs: boolean }) {
  return (
    <div className="grid gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 lg:grid-cols-2">
      {/* Left column: why + priority + action */}
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700">Why this case is flagged</div>
          <ul className="mt-1.5 space-y-1">
            {vm.riskChips.map((c, i) => (
              <li key={i} className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">{c.label}:</span> {c.reason}
              </li>
            ))}
            {vm.riskChips.length === 0 && (
              <li className="text-xs text-slate-500">No risk flags — cross-sell opportunity only.</li>
            )}
          </ul>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">Priority score</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">
              {Math.round(vm.priorityScore).toLocaleString('en-US')}
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">{vm.priorityReason}</p>
          <div className="mt-2 flex gap-3 text-[11px] text-slate-500">
            <span>commission {aed(vm.expectedCommission)}</span>
            <span>× stage {pct(vm.stageProbability)}</span>
            <span>× freshness {vm.stalenessDecay.toFixed(1)}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700">Recommended action</div>
          <p className="mt-1 text-xs text-slate-600">{vm.classificationReason}</p>
          <p className="mt-1 text-xs font-medium text-slate-900">{vm.recommendedAction}</p>
        </div>

        {vm.crossSellChips.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-semibold text-slate-700">Cross-sell triggers</div>
            <ul className="mt-1.5 space-y-1">
              {vm.crossSellChips.map((c, i) => (
                <li key={i} className="text-xs">
                  {c.suppressed ? (
                    <span className="text-slate-400">
                      <span className="line-through decoration-slate-300">{c.label}</span>{' '}
                      — held: client is re-evaluating
                    </span>
                  ) : (
                    <span className="text-slate-600">
                      <span className="font-medium text-slate-800">{c.label}:</span> {c.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {vm.nurture && (
              <p className="mt-2 rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                Nurture track: <span className="font-medium">{titleCase(vm.nurture.track)}</span> —{' '}
                {vm.nurture.reason}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right column: bank + AI brief + WhatsApp */}
      <div className="space-y-3">
        <BankCard vm={vm} />

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold text-slate-700">AI case brief</div>
          {vm.brief ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{vm.brief.brief}</p>
          ) : (
            <p className="mt-1 text-xs italic text-slate-400">
              {hasBriefs
                ? 'No brief generated for this case (only the top 20 by priority get one).'
                : 'AI briefs not generated yet — run scripts/generate_ai_briefs.py locally.'}
            </p>
          )}
        </div>

        {vm.brief && (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-700">WhatsApp draft</div>
              <CopyButton text={vm.brief.whatsapp} />
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-emerald-50 p-2.5 text-xs leading-relaxed text-slate-700">
              {vm.brief.whatsapp}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CaseManager({ rms, queues, stats, hasBriefs }: Props) {
  const [rm, setRm] = useState(rms[0]);
  const [openId, setOpenId] = useState<string | null>(null);
  const queue = queues[rm] ?? [];
  const s = stats[rm];

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-6">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Today</h1>
          <p className="text-sm text-slate-500">
            Your action queue, ranked by AED at stake. Top {queue.length} of {s?.actionable ?? 0}{' '}
            cases needing attention.
          </p>
        </div>
      </div>

      {/* RM selector */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {rms.map((name) => (
          <button
            key={name}
            onClick={() => {
              setRm(name);
              setOpenId(null);
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              name === rm
                ? 'bg-accent text-white'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Stats strip */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <Stat label="Cases in book" value={String(s?.total ?? 0)} />
        <Stat label="Need action" value={String(s?.actionable ?? 0)} />
        <Stat label="Commission at risk" value={aed(s?.atRiskCommission ?? 0)} />
      </div>

      {/* Queue table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Stage</th>
              <th className="px-4 py-2 text-right font-medium">AED at stake</th>
              <th className="px-4 py-2 font-medium">Signals</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {queue.map((vm, i) => {
              const open = openId === vm.id;
              return (
                <FragmentRow
                  key={vm.id}
                  vm={vm}
                  rank={i + 1}
                  open={open}
                  onToggle={() => setOpenId(open ? null : vm.id)}
                  hasBriefs={hasBriefs}
                />
              );
            })}
            {queue.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                  No cases need action for this RM.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function FragmentRow({
  vm,
  rank,
  open,
  onToggle,
  hasBriefs,
}: {
  vm: CaseVM;
  rank: number;
  open: boolean;
  onToggle: () => void;
  hasBriefs: boolean;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
          open ? 'bg-slate-50' : ''
        }`}
      >
        <td className="px-4 py-2.5 text-xs font-semibold text-slate-400">{rank}</td>
        <td className="px-4 py-2.5">
          <div className="font-medium text-slate-900">{vm.clientName}</div>
          <div className="text-[11px] text-slate-400">
            {titleCase(vm.segment)} · {vm.propertyType} · {titleCase(vm.purpose)}
          </div>
        </td>
        <td className="px-4 py-2.5 text-sm text-slate-600">{STAGE_LABELS[vm.stage]}</td>
        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-slate-900">
          {aed(vm.expectedCommission)}
        </td>
        <td className="px-4 py-2.5">
          <ChipRow chips={[...vm.riskChips, ...vm.crossSellChips]} />
          <div className="mt-1 max-w-md text-[11px] text-slate-500">{vm.primaryReason}</div>
        </td>
        <td className="px-4 py-2.5">
          <Badge vm={vm} />
        </td>
        <td className="px-4 py-2.5 text-right text-slate-300">{open ? '▲' : '▼'}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="p-0">
            <Detail vm={vm} hasBriefs={hasBriefs} />
          </td>
        </tr>
      )}
    </>
  );
}
