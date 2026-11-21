import type { Stage } from '@/entities/deal/deal.types';
import type { ConflictGroup, Theirs } from './pipelineClient';

/**
 * Conflicts grouped by what the other person did ("Rahul moved 9 deals to Lost"),
 * biggest group first, so many conflicts become a few decisions.
 */
export function groupConflicts(conflicts: Iterable<{ id: string; wanted: Stage; theirs: Theirs }>): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  for (const { id, wanted, theirs: t } of conflicts) {
    const key = `${t.by}\u0000${t.stage}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, by: t.by, self: t.self, stage: t.stage, ids: [], wanted: {}, latestAt: 0 }));
    g.ids.push(id);
    g.wanted[wanted] = (g.wanted[wanted] ?? 0) + 1;
    g.latestAt = Math.max(g.latestAt, t.at);
  }
  return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length || b.latestAt - a.latestAt);
}
