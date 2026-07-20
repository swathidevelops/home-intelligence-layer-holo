// Screen 1 — Case Manager view ("Today"). Server component: runs the engine at
// build time, hands small view models to the interactive client component.

import CaseManager from '@/components/CaseManager';
import { RMS, actionQueue, rmStats, type CaseVM } from '@/lib/data';
import briefsJson from '@/data/ai_briefs.json';

export default function CaseManagerPage() {
  const queues: Record<string, CaseVM[]> = {};
  const stats: Record<string, ReturnType<typeof rmStats>> = {};
  for (const rm of RMS) {
    queues[rm] = actionQueue(rm, 10);
    stats[rm] = rmStats(rm);
  }
  const hasBriefs = (briefsJson as unknown as unknown[]).length > 0;

  return <CaseManager rms={RMS} queues={queues} stats={stats} hasBriefs={hasBriefs} />;
}
