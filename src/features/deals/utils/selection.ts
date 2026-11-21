import { type Stage } from '@/entities/deal';

/**
 * Selection remembers the stage each deal had *when the user selected it*.
 * Bulk moves send that as the compare-and-set `expected` value, so a deal a
 * teammate changed after selection comes back as a conflict instead of being
 * silently overwritten.
 */
export type Selection = ReadonlyMap<string, Stage>;

export const clampIndex = (i: number, len: number) => (len === 0 ? 0 : Math.max(0, Math.min(len - 1, i)));

export function toggle(sel: Selection, id: string, stage: Stage): Selection {
  const next = new Map(sel);
  if (next.has(id)) next.delete(id);
  else next.set(id, stage);
  return next;
}

/** Add every id between a and b (inclusive, either order) to the selection. */
export function selectRange(
  sel: Selection, rowIds: readonly string[], a: number, b: number, stageOf: (id: string) => Stage | undefined,
): Selection {
  const next = new Map(sel);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = Math.max(0, lo); i <= Math.min(rowIds.length - 1, hi); i++) {
    const stage = stageOf(rowIds[i]);
    if (stage) next.set(rowIds[i], stage);
  }
  return next;
}

export function selectAll(rowIds: readonly string[], stageOf: (id: string) => Stage | undefined): Selection {
  const next = new Map<string, Stage>();
  for (const id of rowIds) {
    const s = stageOf(id);
    if (s) next.set(id, s);
  }
  return next;
}

/** Add (on) or remove (off) many deals at once. */
export function setMany(sel: Selection, ids: readonly string[], stageOf: (id: string) => Stage | undefined, on: boolean): Selection {
  const next = new Map(sel);
  for (const id of ids) {
    if (!on) next.delete(id);
    else {
      const s = stageOf(id);
      if (s) next.set(id, s);
    }
  }
  return next;
}

/**
 * The deals of a board column that are really in that stage. A column can also
 * show cards a teammate already moved elsewhere (dimmed, "now in X"); "select
 * all in Contacted" must not pick those up, or the bulk move would start from
 * the wrong stage.
 */
export function inStage(ids: readonly string[], stage: Stage, stageOf: (id: string) => Stage | undefined): string[] {
  return ids.filter((id) => stageOf(id) === stage);
}

/** Selected deals that are not in `rowIds` (e.g. teammates' changes took them out of the view). */
export function notInView(sel: Selection, rowIds: readonly string[]): string[] {
  if (!sel.size) return [];
  const inView = new Set(rowIds);
  return [...sel.keys()].filter((id) => !inView.has(id));
}
