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

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-6">
      <h1 className="text-lg font-semibold tracking-tight text-slate-900">Leadership</h1>
      <p className="mb-5 text-sm text-slate-500">
        Portfolio view across {data.totals.cases} cases. Synthetic book.
      </p>

      {/* Headline banner */}
      <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold tabular-nums text-rose-700">
            {aedShort(data.atRiskTotal)}
          </span>
          <span className="text-sm text-rose-600">
            commission at risk across {data.atRiskCount} flagged cases
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.reasonBreakdown.map((r) => (
            <div
              key={r.reason}
              className="rounded-md bg-white/70 px-2.5 py-1.5 text-xs ring-1 ring-rose-100"
            >
              <span className="font-medium text-slate-700">{r.reason}</span>
              <span className="ml-1.5 text-slate-400">
                {r.count} · {aedShort(r.commission)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Revenue at risk by stage */}
        <Card title="Revenue at risk by stage" subtitle="Expected commission on flagged cases">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stageData} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
              <XAxis
                dataKey="stage"
                tick={{ fontSize: 11, fill: '#64748b' }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
              />
              <YAxis tickFormatter={(v) => aedShort(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} width={64} />
              <Tooltip
                formatter={(v: number) => aed(v)}
                labelStyle={{ color: '#0f172a' }}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="commission" radius={[4, 4, 0, 0]} fill={ROSE}>
                <LabelList
                  dataKey="count"
                  position="top"
                  formatter={(v: number) => `${v}`}
                  style={{ fontSize: 10, fill: '#94a3b8' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Funnel leakage */}
        <Card title="Funnel" subtitle="Cases that reached each stage (grey) vs sit there now (teal)">
          <div className="space-y-1.5">
            {data.funnel.map((f) => (
              <div key={f.stage} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 text-slate-500">{STAGE_LABELS[f.stage as Stage]}</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className="absolute inset-y-0 left-0 bg-slate-200"
                    style={{ width: `${(f.reached / maxReached) * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-accent/70"
                    style={{ width: `${(f.current / maxReached) * 100}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
                  {f.reached} → {f.current}
                </span>
              </div>
            ))}
          </div>
        </Card>

        {/* Cross-sell attachment */}
        <Card title="Cross-sell attachment" subtitle="Attached of eligible cases">
          <div className="space-y-3">
            {data.attachment.map((a) => (
              <div key={a.service}>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600">{a.service}</span>
                  <span className="tabular-nums text-slate-400">
                    {a.attached}/{a.eligible} · {pct(a.rate)}
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
            Life insurance is mandatory with a UAE mortgage — the gap on signed cases is pure
            leakage and the first Week-1 win.
          </p>
        </Card>

        {/* Handover pipeline + recovered placeholder */}
        <div className="grid grid-rows-2 gap-5">
          <Card title="Handover pipeline" subtitle="Offplan handovers within 180 days">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums text-accent">
                {data.handover.count}
              </span>
              <span className="text-sm text-slate-500">cases</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {aed(data.handover.futureCommission)} in future commission to pre-arrange.
            </p>
          </Card>
          <Card title="Recovered this month" subtitle="Placeholder — wired once write-back lands">
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums text-slate-300">—</span>
              <span className="text-sm text-slate-400">
                measures commission saved from flagged cases that closed
              </span>
            </div>
          </Card>
        </div>
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
