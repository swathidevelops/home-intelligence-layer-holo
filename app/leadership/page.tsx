// Screen 2 — Leadership view. Server component computes aggregates; the client
// component renders charts (recharts) and the eval panel.

import Leadership from '@/components/Leadership';
import { leadershipData, evalResults } from '@/lib/data';

export default function LeadershipPage() {
  return <Leadership data={leadershipData()} evalResults={evalResults} />;
}
