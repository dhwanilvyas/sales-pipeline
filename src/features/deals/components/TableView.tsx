import { memo, useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { TruncatedText } from '@/shared/ui/truncated-text';
import { fmtINR, fmtRelDay } from '@/shared/utils/format';
import { SaveStatus } from '@/features/deals/components/SaveStatus';
import { StageMenu } from '@/features/deals/components/StageMenu';
import type { DealActions } from '@/features/deals/types';
import { ReasonChips } from '@/features/deals/components/ReasonChips';
import { UpdatedBy } from '@/features/deals/components/UpdatedBy';
import { matches, prioritize, type Query, type SortKey, type Stage } from '@/entities/deal';
import { type DealView, type PipelineClient } from '@/features/deals/api/pipelineClient';

export const ROW_HEIGHT = 44;
const COLS = 'grid-cols-[36px_minmax(190px,2fr)_132px_112px_92px_96px_86px_minmax(170px,1.6fr)_minmax(130px,1.1fr)_minmax(150px,1.3fr)]';

const HEADERS: { key: SortKey | null; label: string; align?: 'right' }[] = [
  { key: 'name', label: 'Deal' },
  { key: 'stage', label: 'Stage' },
  { key: 'value', label: 'Value', align: 'right' },
  { key: 'owner', label: 'Owner' },
  { key: 'nextStep', label: 'Follow-up' },
  { key: 'close', label: 'Close' },
  { key: 'priority', label: 'Why now' },
  { key: 'updated', label: 'Last update' },
  { key: null, label: 'Save status' },
];

interface TableProps {
  client: PipelineClient;
  rowIds: readonly string[];
  focusedIndex: number;
  /** Changes when the highlighted row should be scrolled to again ("Show"). */
  reveal: number;
  selection: ReadonlyMap<string, Stage>;
  menuId: string | null;
  query: Query;
  now: number;
  actions: DealActions;
  onSort(key: SortKey): void;
  containerRef: RefObject<HTMLDivElement | null>;
  empty: ReactNode;
}

/**
 * Dense, sortable list of the current view. Only ~40 rows are ever mounted
 * (virtualised); rows are memoised on immutable view objects, so a teammate's
 * edit re-renders just that row.
 */
export function TableView({ client, rowIds, focusedIndex, reveal, selection, menuId, query, now, actions, onSort, containerRef, empty }: TableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rowIds.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the focused row on screen when moving with the keyboard.
  // "Show" (reveal) centres the row, so it's never left under the job tray.
  const revealRef = useRef(reveal);
  useEffect(() => {
    const revealing = revealRef.current !== reveal;
    revealRef.current = reveal;
    if (rowIds.length) virtualizer.scrollToIndex(focusedIndex, { align: revealing ? 'center' : 'auto' });
  }, [focusedIndex, rowIds, reveal, virtualizer]);

  const focusedId = rowIds[focusedIndex];

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label="Deals"
      aria-rowcount={rowIds.length}
      aria-multiselectable
      aria-activedescendant={focusedId ? `deal-${focusedId}` : undefined}
      tabIndex={0}
      className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <div role="row" className={cn('grid shrink-0 items-center gap-2 border-b bg-muted/50 px-2 text-xs font-medium text-muted-foreground', COLS)} style={{ height: 34 }}>
        <span role="columnheader"><span className="sr-only">Selected</span></span>
        {HEADERS.map((h) => (
          <span key={h.label} role="columnheader" className={h.align === 'right' ? 'text-right' : undefined}
            aria-sort={h.key && query.sort.key === h.key ? (query.sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            {h.key ? (
              <button type="button" tabIndex={-1} onClick={() => onSort(h.key!)} className="inline-flex items-center gap-1 hover:text-foreground">
                {h.label}
                {query.sort.key === h.key && (query.sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
              </button>
            ) : h.label}
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {rowIds.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          // id: document.getElementById('table-rows').children.length shows how few rows are actually in the page.
          <div id="table-rows" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const id = rowIds[vi.index];
              const view = client.getView(id);
              if (!view) return null;
              return (
                <DealRow
                  key={id}
                  view={view}
                  index={vi.index}
                  top={vi.start}
                  focused={vi.index === focusedIndex}
                  selected={selection.has(id)}
                  menuOpen={menuId === id}
                  bulkCount={selection.size > 1 && selection.has(id) ? selection.size : 0}
                  dim={!matches(view.deal, query, now)}
                  me={client.me}
                  now={now}
                  actions={actions}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  view: DealView;
  index: number;
  top: number;
  focused: boolean;
  selected: boolean;
  menuOpen: boolean;
  bulkCount: number;
  dim: boolean;
  me: string;
  now: number;
  actions: DealActions;
}

const DealRow = memo(function DealRow({ view, index, top, focused, selected, menuOpen, bulkCount, dim, me, now, actions }: RowProps) {
  const d = view.deal;
  const pr = prioritize(d, now);
  return (
    <div
      id={`deal-${d.id}`}
      role="row"
      aria-selected={selected}
      aria-rowindex={index + 1}
      onMouseDown={(e) => e.preventDefault() /* keep focus on the grid */}
      onClick={(e) => actions.click(d.id, e)}
      className={cn(
        'absolute inset-x-0 grid cursor-default items-center gap-2 border-b px-2 text-sm',
        COLS,
        selected && 'bg-primary/8',
        focused && 'z-[1] bg-accent outline-2 -outline-offset-2 outline-ring',
        dim && 'opacity-50',
      )}
      style={{ top, height: ROW_HEIGHT }}
    >
      <span role="gridcell" className="flex justify-center">
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={`Select ${d.name}`}
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => actions.toggle(d.id, (e.nativeEvent as unknown as MouseEvent).shiftKey)}
          className="size-4 accent-primary"
        />
      </span>
      <span role="gridcell" className="min-w-0">
        <TruncatedText className="block font-medium">{d.name}</TruncatedText>
        <span className="block truncate text-xs text-muted-foreground">
          {d.id} · {d.licences} licences{dim && ' · no longer matches this view'}
        </span>
      </span>
      <span role="gridcell" className="min-w-0"><StageMenu view={view} open={menuOpen} bulkCount={bulkCount} actions={actions} /></span>
      <span role="gridcell" className="text-right tabular-nums">{fmtINR(d.value)}</span>
      <span role="gridcell" className={cn('truncate', d.owner === me && 'font-medium')}>{d.owner === me ? 'Me' : d.owner}</span>
      <span role="gridcell" className={cn('text-xs', d.nextStepAt != null && d.nextStepAt < now && pr.actionable && 'font-medium text-rose-600 dark:text-rose-400')}>
        {d.nextStepAt == null ? '—' : fmtRelDay(d.nextStepAt, now)}
      </span>
      <span role="gridcell" className="text-xs">{fmtRelDay(d.expectedCloseAt, now)}</span>
      <span role="gridcell" className="flex min-w-0 gap-1 overflow-hidden"><ReasonChips reasons={pr.reasons} /></span>
      <span role="gridcell" className="min-w-0 text-xs"><UpdatedBy view={view} me={me} now={now} /></span>
      <span role="gridcell" className="min-w-0 text-xs"><SaveStatus view={view} actions={actions} /></span>
    </div>
  );
});
