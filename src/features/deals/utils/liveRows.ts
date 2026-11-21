import { matches, type Deal, type Query } from '@/entities/deal';

/**
 * Views of your own deals (My deals, Follow up today, Gone quiet) show others'
 * changes at once: they're occasional, they're about your deals, and only ~20
 * cards are on screen anyway. Example: your manager moves Acme to Lost; the
 * card moves now, with a toast saying who did it.
 *
 * From the snapshot, deals someone changed so they no longer belong leave, and
 * deals that now belong (e.g. reassigned to you) join at the top. A deal you're
 * holding (being dragged, or its menu is open) stays until you let go.
 */
export function liveRows(
  snapshot: readonly string[],
  changed: Iterable<string>,
  getDeal: (id: string) => Deal | undefined,
  q: Query,
  now: number,
  hold: ReadonlySet<string>,
): readonly string[] {
  const inSnapshot = new Set(snapshot);
  const gone = new Set<string>();
  const joined: string[] = [];
  for (const id of changed) {
    const d = getDeal(id);
    if (!d) continue;
    const belongs = matches(d, q, now);
    if (inSnapshot.has(id) && !belongs && !hold.has(id)) gone.add(id);
    else if (!inSnapshot.has(id) && belongs) joined.push(id);
  }
  if (!gone.size && !joined.length) return snapshot; // same array: nothing re-renders
  return [...joined, ...snapshot.filter((id) => !gone.has(id))];
}
