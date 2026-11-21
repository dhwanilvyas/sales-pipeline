import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fmtNum, plural } from '@/shared/utils/format';
import { useStableCallbacks } from '@/shared/hooks/useStableCallbacks';
import { STAGE_LABEL, type Query, type Stage } from '@/entities/deal';
import type { PipelineClient } from '@/features/deals/api/pipelineClient';
import { inStage, notInView, selectAll, selectRange, setMany, toggle as flip, type Selection } from '@/features/deals/utils/selection';
import type { DealRows } from './useDealRows';

const EMPTY: Selection = new Map();

/**
 * Which deals are selected, and the stage each was in WHEN selected. That
 * stage is sent as `expected` with a bulk move, so the server refuses any deal
 * a teammate moved in the meantime (a conflict) instead of overwriting it.
 *
 * Shift-ranges extend from an anchor (the last deal clicked or toggled) within
 * one list (the table, or one board column).
 */
export function useSelection(client: PipelineClient, rows: Pick<DealRows, 'rev' | 'rowIds' | 'columns' | 'lists' | 'posOf'>, query: Query) {
  const [selection, setPicked] = useState<Selection>(EMPTY);
  /**
   * Set when the selection is "everything in this view" (or one column of it), made with Ctrl/⌘+A or a
   * column's checkbox. A move then sends this FILTER and the server runs it as a job; any other way of
   * selecting is hand-picked IDs (up to MAX_MOVE_ITEMS).
   */
  const [whole, setWhole] = useState<Query | null>(null);
  const setSelection = (next: Selection | ((s: Selection) => Selection), all: Query | null = null) => {
    setPicked(next);
    setWhole(all);
  };
  const anchor = useRef<string | null>(null);
  const stageOf = useCallback((id: string) => client.getView(id)?.deal.stage, [client]);

  const range = (sel: Selection, id: string): Selection => {
    const a = anchor.current ? rows.posOf.get(anchor.current) : undefined;
    const b = rows.posOf.get(id);
    if (!a || !b || a.col !== b.col) return flip(sel, id, stageOf(id)!);
    return selectRange(sel, rows.lists[b.col], a.idx, b.idx, stageOf);
  };

  const ops = useStableCallbacks({
    /**
     * Mouse: Shift extends from the anchor, Ctrl/⌘ toggles. A plain click only highlights,
     * unless something is already selected ("selection mode"): then it toggles, like Gmail.
     */
    click(id: string, mods: { shift: boolean; toggle: boolean }) {
      if (mods.shift && anchor.current) setSelection((s) => range(s, id));
      else if (mods.toggle || selection.size > 0) setSelection((s) => flip(s, id, stageOf(id)!));
      if (!mods.shift) anchor.current = id;
    },
    /** A card's or row's checkbox. */
    checkbox(id: string, shift: boolean) {
      setSelection((s) => (shift && anchor.current ? range(s, id) : flip(s, id, stageOf(id)!)));
      anchor.current = id;
    },
    /** `x` on the highlighted deal. */
    toggle(id: string) {
      setSelection((s) => flip(s, id, stageOf(id)!));
      anchor.current = id;
    },
    /** Shift+arrow: extend to `id`, starting from `from` if nothing was anchored yet. */
    extendTo(id: string, from: string | null) {
      anchor.current ??= from;
      setSelection((s) => range(s, id));
    },
    /** Plain arrow: the next shift-range starts here. */
    moveAnchor(id: string) {
      anchor.current = id;
    },
    selectMany(ids: readonly string[], on: boolean) {
      setSelection((s) => setMany(s, ids, stageOf, on));
    },
    /** A board column's checkbox: on an empty selection that's "this whole column" (a filter). */
    selectColumn(stage: Stage, ids: readonly string[], on: boolean) {
      if (on && selection.size === 0) setSelection(setMany(EMPTY, ids, stageOf, true), { ...query, stage });
      else setSelection((s) => setMany(s, ids, stageOf, on));
    },
    selectOnly(ids: readonly string[]) {
      setSelection(setMany(EMPTY, ids, stageOf, true));
    },
    selectAll() {
      setSelection(selectAll(rows.rowIds, stageOf), query);
    },
    /**
     * Ctrl/⌘+A grows the selection: on the board, first the column you're in
     * (only deals really in that stage), then everything in the view.
     */
    selectAllStep(col: number | null) {
      const column = rows.columns && col !== null ? rows.columns[col] : null;
      if (column) {
        const ids = inStage(column.ids, column.stage, stageOf);
        if (ids.length && !ids.every((id) => selection.has(id))) {
          setSelection(setMany(EMPTY, ids, stageOf, true), { ...query, stage: column.stage });
          const left = column.ids.length - ids.length;
          toast(`Selected ${plural(ids.length, 'deal')} in ${STAGE_LABEL[column.stage]}`, {
            id: 'select-all',
            description: `${left ? `${plural(left, 'deal')} moved by others not included. ` : ''}Press Ctrl/⌘+A again for all ${fmtNum(rows.rowIds.length)} in this view.`,
            duration: 3000,
          });
          return;
        }
      }
      setSelection(selectAll(rows.rowIds, stageOf), query);
    },
    /** Returns false if there was nothing to clear (so Esc can do something else). */
    clear(): boolean {
      if (!selection.size) return false;
      setSelection(EMPTY);
      return true;
    },
  });

  // After "Apply changes" the list is rebuilt: selected deals that no longer match the view
  // are unselected, so a bulk move can never hit deals you can't see.
  const shownRows = useRef(rows.rowIds);
  useEffect(() => {
    if (shownRows.current === rows.rowIds) return;
    shownRows.current = rows.rowIds;
    const gone = notInView(selection, rows.rowIds);
    if (!gone.length) return;
    setSelection(setMany(selection, gone, stageOf, false), whole); // still "the whole view": the server re-checks it anyway
    toast(`${plural(gone.length, 'selected deal')} no longer in this view`, {
      id: 'selection-pruned',
      description: 'Teammates changed them, so they were unselected. Your selection only contains deals you can see.',
    });
  }, [rows.rowIds]); // runs only when the snapshot changes

  /** Failed / conflicted deals in the selection (for the bulk bar's fix-it buttons). */
  const issues = useMemo(() => {
    let failed = 0, conflict = 0;
    for (const id of selection.keys()) {
      const s = client.getView(id)?.status;
      if (s === 'failed') failed++;
      else if (s === 'conflict') conflict++;
    }
    return { failed, conflict };
  }, [selection, client, rows.rev]);

  return { selection, whole, stageOf, issues, ...ops };
}

export type SelectionState = ReturnType<typeof useSelection>;
