import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { plural } from '@/shared/utils/format';
import { useThrottled } from '@/shared/hooks/useThrottled';
import { runQuery, summarize, type Query, type Stage } from '@/entities/deal';
import type { PipelineClient } from '@/features/deals/api/pipelineClient';
import { buildColumns } from '@/features/deals/utils/boardColumns';
import { liveRows } from '@/features/deals/utils/liveRows';
import { relevantChange } from '@/features/deals/utils/relevantChanges';
import type { BoardColumn, Layout } from '@/features/deals/types';
import { useClientRev } from './useClientRev';

export interface Position {
  col: number;
  idx: number;
}

/**
 * From the client's data to what's on screen.
 *
 * The ORDER is a snapshot: `rowIds` is rebuilt only when the query changes or
 * the user applies others' changes (`refresh`), never when data changes, so
 * background updates never reshuffle what you're looking at. What each card
 * shows (stage, status, "now in X") is re-read on every client change (`rev`).
 *
 * `rev` appears in memo dependencies without being read: it's how a memo
 * learns that the client's data changed.
 */
export function useDealRows(client: PipelineClient, query: Query, layout: Layout, now: number, hold: ReadonlySet<string>) {
  const rev = useClientRev(client);
  const [refreshToken, setRefreshToken] = useState(0);
  /**
   * Views of your own deals apply others' changes at once (liveRows.ts). The
   * shared All deals view changes constantly, so there they wait behind "Apply".
   */
  const live = query.scope === 'mine';

  const snapshot = useMemo(
    () => runQuery(client.rows(), query, Date.now()),
    [client, query, refreshToken], // not rev: see above
  );
  // A new snapshot includes everything changed so far: nothing left to "apply".
  useEffect(() => client.clearExternal(), [client, snapshot]);

  const rowIds = useMemo(
    () => (live ? liveRows(snapshot, client.externalIds(), (id) => client.getView(id)?.deal, query, Date.now(), hold) : snapshot),
    [live, snapshot, client, query, hold, rev],
  );

  const snapshotStage = useMemo(() => new Map<string, Stage>(snapshot.map((id) => [id, client.getView(id)!.deal.stage])), [client, snapshot]);
  const columns: BoardColumn[] | null = useMemo(
    () => (layout === 'board' ? buildColumns(rowIds, snapshotStage, (id) => client.getView(id), client.session, query.me, live ? { hold } : undefined) : null),
    [layout, rowIds, snapshotStage, client, query.me, live, hold, rev],
  );

  // Others' changes that matter here (on screen, or now in this view), not the whole pipeline's.
  const isRelevant = useMemo(
    () => relevantChange(new Set(snapshot), (id) => client.getView(id)?.deal, query, Date.now()),
    [client, snapshot, query],
  );

  // Keyboard navigation works on lists: one for the table, one per board column.
  const lists = useMemo(() => (columns ? columns.map((c) => c.ids) : [rowIds]), [columns, rowIds]);
  const posOf = useMemo(() => {
    const m = new Map<string, Position>();
    lists.forEach((ids, col) => ids.forEach((id, idx) => m.set(id, { col, idx })));
    return m;
  }, [lists]);

  // Stage bar + view counts: a full pass over 50k deals, so at most every 500ms.
  // Deliberately ignores the stage filter and sort (counts are per stage/view).
  const slowRev = useThrottled(rev, 500);
  const sums = useMemo(
    () => summarize(client.rows(), query, now),
    [client, slowRev, query.view, query.scope, query.search, query.me, now],
  );

  // Others' changes waiting for "Apply" (the pill). None in a live view: they're already applied.
  const pendingUpdates = useMemo(() => {
    if (live) return 0;
    let n = 0;
    for (const id of client.externalIds()) if (isRelevant(id)) n++;
    return n;
  }, [client, isRelevant, live, rev]);

  /** Apply others' changes to the order (cards move to their new columns/positions). */
  const refresh = () => {
    const n = pendingUpdates;
    setRefreshToken((t) => t + 1);
    if (n > 0) toast.success(`List updated · ${plural(n, 'change')} applied`, { id: 'refresh', duration: 2500 });
    else toast(`You're up to date`, { id: 'refresh', description: 'No changes from others since your last refresh.', duration: 2500 });
  };

  return { rev, rowIds, columns, lists, posOf, sums, pendingUpdates, isRelevant, refresh, live };
}

export type DealRows = ReturnType<typeof useDealRows>;
