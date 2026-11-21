import type { BoardColumn } from '@/features/deals/types';
import { STAGES, type Stage } from '@/entities/deal';
import { type DealView } from '@/features/deals/api/pipelineClient';

/**
 * Decide which column each card sits in.
 *
 *  - Order comes from the snapshot taken when the view was (re)built, like the table.
 *  - MY changes (pending, or last saved by me in ANY of my tabs) move the card
 *    at once, to the top of its new column, so drag/keys feel immediate.
 *  - Anyone else's change does NOT move the card: it stays where you saw it,
 *    dimmed with "now in X", until you refresh (`.`). Nothing jumps under you.
 *  - Except in `live` views (your own deals, see liveRows.ts): there others'
 *    changes move the card at once, unless you're holding it (dragging it, or
 *    its menu is open).
 */
export function buildColumns(
  rowIds: readonly string[],
  snapshotStage: ReadonlyMap<string, Stage>,
  getView: (id: string) => DealView | undefined,
  session: string,
  me: string,
  live?: { hold: ReadonlySet<string> },
): BoardColumn[] {
  const movedIn = Object.fromEntries(STAGES.map((s) => [s, [] as string[]])) as Record<Stage, string[]>;
  const stayed = Object.fromEntries(STAGES.map((s) => [s, [] as string[]])) as Record<Stage, string[]>;
  const totals = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }])) as Record<Stage, { count: number; value: number }>;

  for (const id of rowIds) {
    const v = getView(id);
    const snap = snapshotStage.get(id) ?? (live ? v?.deal.stage : undefined); // joined a live view since
    if (!v || !snap) continue;
    // Mine: my unsaved change, my saved one (any tab), or their change I explicitly accepted ("Keep theirs").
    const mine = v.status !== null || v.deal.updatedBySession === session || v.deal.updatedBy === me || !!v.accepted;
    const col = mine || (live && !live.hold.has(id)) ? v.deal.stage : snap;
    (col === snap ? stayed : movedIn)[col].push(id);
    totals[col].count++;
    totals[col].value += v.deal.value;
  }
  return STAGES.map((stage) => ({ stage, ids: [...movedIn[stage], ...stayed[stage]], ...totals[stage] }));
}
