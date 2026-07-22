'use client';

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LeadershipData, EvalResults } from '@/lib/data';
import { aed, aedShort, pct, STAGE_LABELS } from '@/lib/format';
import type { Stage } from '@/lib/engine';

const ACCENT = '#0f766e';
const ROSE = '#e11d48';
const AMBER = '#d97706';

function Card({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Leadership({
  data,
  evalResults,
}: {
  data: LeadershipData;
  evalResults: EvalResults;
}) {
  const cls = evalResults.classifier;
  const briefs = evalResults.llm_briefs;

  const stageData = data.revenueByStage.map((r) => ({
    stage: STAGE_LABELS[r.stage as Stage],
    commission: r.commission,
    count: r.count,
  }));

  const maxReached = Math.max(...data.funnel.map((f) => f.reached), 1);
  const recoveryOpportunity = Math.round(data.recoverablePct * 100);
  const topReasonsAbbrv = data.reasonBreakdown.slice(0, 2).map((r) => r.reason).join(', ');

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight text-slate-900">Leadership</h1>
      <p className="mb-5 text-sm text-slate-500">
        Funnel health, leakage, and revenue at risk across {data.totals.cases} cases.
      </p>

      {/* Strategic headline banner */}
      <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-4xl font-bold tabular-nums text-rose-700">
            {aedShort(data.atRiskTotal)}
          </span>
          <span className="text-sm text-rose-600">
            at stake ({data.atRiskCount} cases)
          </span>
        </div>
        <p className="text-sm text-rose-700">
          {recoveryOpportunity}% are engaged stalls (recoverable with action). Most concentrated in{' '}
          <span className="font-semibold">{STAGE_LABELS[data.weakestStage.stage as Stage]}</span>{' '}
          due to <span className="font-semibold">{data.topReason.reason.toLowerCase()}</span>.
        </p>
        <p className="mt-3 text-xs text-rose-600">
          AED at stake = expected commission on this case.
        </p>
      </div>

      {/* Funnel and leakage story */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Funnel leakage — the drop-off story */}
        <Card title="Funnel" subtitle="Reached vs currently in each stage" className="lg:col-span-2">
          <div className="space-y-2.5">
            {data.funnel.map((f) => {
              const leakage = f.reached - f.current;
              const leakagePct = f.reached > 0 ? (leakage / f.reached) * 100 : 0;
              return (
                <div key={f.stage}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-slate-700">
                      {STAGE_LABELS[f.stage as Stage]}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {f.current}/{f.reached}
                      {leakage > 0 && (
                        <span className="ml-2 text-rose-600">
                          ↓ {leakage} ({leakagePct.toFixed(0)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="relative h-5 overflow-hidden rounded bg-slate-100">
                    <div
                      className="absolute inset-y-0 left-0 bg-slate-200"
                      style={{ width: `${(f.reached / maxReached) * 100}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-accent/70"
                      style={{ width: `${(f.current / maxReached) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-400">Grey = reached, teal = currently in stage.</p>
        </Card>

        {/* Where money gets stuck */}
        <Card title="Leakage concentration" subtitle="At-risk cases per stage">
          <div className="space-y-2">
            {data.stageHealth
              .filter((s) => s.flaggedCount > 0)
              .sort((a, b) => b.atRisk - a.atRisk)
              .slice(0, 6)
              .map((s) => (
                <div key={s.stage} className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-600">{STAGE_LABELS[s.stage as Stage]}</span>
                  <div className="flex items-baseline gap-1">
                    <span className="font-semibold text-rose-700">{s.flaggedCount}</span>
                    <span className="text-slate-500">of {s.current}</span>
                    <span className="text-slate-400">({pct(s.flaggedPct)})</span>
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Stages with the most flagged cases, ranked by cases at stake.
          </p>
        </Card>
      </div>

      {/* Why cases are at risk — reason breakdown */}
      <Card title="Top leakage reasons" subtitle="By AED at stake" className="mt-5">
        <div className="space-y-2">
          {data.reasonBreakdown.map((r) => {
            const pctOfTotal = (r.commission / data.atRiskTotal) * 100;
            return (
              <div key={r.reason} className="flex items-center justify-between text-xs">
                <div className="flex-1">
                  <div className="mb-1 flex justify-between">
                    <span className="font-medium text-slate-700">{r.reason}</span>
                    <span className="text-slate-500">
                      {r.count} cases · {aedShort(r.commission)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full bg-rose-600"
                      style={{ width: `${pctOfTotal}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Opportunities: cross-sell + handover */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Cross-sell attachment" subtitle="Service-by-service eligible vs attached">
          <div className="space-y-3">
            {data.attachment.map((a) => (
              <div key={a.service}>
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-700">{a.service}</span>
                  <span className="tabular-nums text-slate-600">
                    {a.attached}/{a.eligible} ({pct(a.rate)})
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${a.rate * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Life insurance on signed cases is the Week-1 quick win.
          </p>
        </Card>

        <Card title="Handover pipeline" subtitle="Future commission to pre-arrange">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums text-accent">
              {aedShort(data.handover.futureCommission)}
            </span>
            <span className="text-sm text-slate-600">across {data.handover.count} cases</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Offplan handovers within 180 days. Pre-arrange now to capture at closing.
          </p>
        </Card>
      </div>

      {/* Bank performance */}
      <Card title="Bank performance snapshot" subtitle="By each case's selected lender" className="mt-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="px-3 py-1.5 font-medium">Bank</th>
                <th className="px-3 py-1.5 text-right font-medium">In-funnel cases</th>
                <th className="px-3 py-1.5 text-right font-medium">Avg days to fund</th>
                <th className="px-3 py-1.5 text-right font-medium">Avg commission</th>
                <th className="px-3 py-1.5 text-right font-medium">Total expected commission</th>
              </tr>
            </thead>
            <tbody>
              {data.banks.map((b) => (
                <tr key={b.bank} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{b.bank}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {b.inFunnel}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {b.avgDaysToFund}d
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {(b.avgCommissionPct * 100).toFixed(2)}%
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">
                    {aed(b.totalCommission)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Eval panel */}
      <Card
        title="Model evaluation"
        subtitle={`Stall classifier vs ${cls.n} hand-labelled cases · accuracy ${pct(
          cls.accuracy,
        )}`}
        className="mt-5"
      >
        <div className="grid gap-5 md:grid-cols-2">
          {/* Confusion matrix */}
          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Confusion matrix (rows = hand label, cols = engine)
            </div>
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-1"></th>
                  {cls.classes.map((c) => (
                    <th key={c} className="p-1 font-medium text-slate-400">
                      {shortClass(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cls.confusion_matrix.map((row, i) => (
                  <tr key={i}>
                    <td className="p-1 pr-2 text-right font-medium text-slate-400">
                      {shortClass(cls.classes[i])}
                    </td>
                    {row.map((v, j) => (
                      <td key={j} className="p-1">
                        <div
                          className={`flex h-9 w-16 items-center justify-center rounded text-sm font-semibold tabular-nums ${
                            i === j
                              ? 'bg-accent/15 text-accent'
                              : v > 0
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-slate-50 text-slate-300'
                          }`}
                        >
                          {v}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Per-class + brief pass rate */}
          <div className="space-y-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1 font-medium">Class</th>
                  <th className="py-1 text-right font-medium">Precision</th>
                  <th className="py-1 text-right font-medium">Recall</th>
                  <th className="py-1 text-right font-medium">Support</th>
                </tr>
              </thead>
              <tbody>
                {cls.classes.map((c) => {
                  const p = cls.per_class[c];
                  return (
                    <tr key={c} className="border-t border-slate-100">
                      <td className="py-1 text-slate-700">{shortClass(c)}</td>
                      <td className="py-1 text-right tabular-nums text-slate-600">
                        {p.precision.toFixed(2)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-600">
                        {p.recall.toFixed(2)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-slate-400">{p.support}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="rounded-md bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">LLM brief checks</div>
              {briefs.status === 'run' ? (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold text-accent">
                    {briefs.passed}/{briefs.n} passed ({pct(briefs.pass_rate)})
                  </span>{' '}
                  — numbers grounded, action matches engine, no invented details, under 60 words.
                </p>
              ) : (
                <p className="mt-1 text-xs italic text-slate-400">
                  Not run yet — generate AI briefs locally, then re-run the eval.
                </p>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-400">
          {cls.disagreements.length} disagreement
          {cls.disagreements.length === 1 ? '' : 's'} shown honestly, not hidden:{' '}
          {cls.disagreements
            .map((d) => `${d.id} (mine ${shortClass(d.gold_label)} / engine ${shortClass(d.predicted)})`)
            .join(', ') || 'none'}
          .
        </p>
      </Card>
    </main>
  );
}

function shortClass(c: string): string {
  return c === 'RATIONAL_PAUSE' ? 'Pause' : c === 'STALLED' ? 'Stalled' : 'Healthy';
}
