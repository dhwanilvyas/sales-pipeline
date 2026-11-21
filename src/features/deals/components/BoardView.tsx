import { memo, useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/shared/utils/cn';
import { fmtINR, fmtINRCompact, fmtNum } from '@/shared/utils/format';
import { TruncatedText } from '@/shared/ui/truncated-text';
import { InitialsAvatar } from '@/shared/ui/initials-avatar';
import { SaveStatus } from '@/features/deals/components/SaveStatus';
import type { BoardColumn, DealActions } from '@/features/deals/types';
import { ReasonChips } from '@/features/deals/components/ReasonChips';
import { STAGE_LABEL, matches, ownerInitials, prioritize, type Query, type Stage } from '@/entities/deal';
import { STAGE_STYLE } from '@/features/deals/utils/stageStyle';
import { UpdatedBy } from '@/features/deals/components/UpdatedBy';
import { type DealView, type PipelineClient } from '@/features/deals/api/pipelineClient';

const CARD_HEIGHT = 112;
const GAP = 8;
/** Vertical distance between card tops (for page-up/down). */
export const CARD_STEP = CARD_HEIGHT + GAP;
const DRAG_TYPE = 'text/x-deal-id';

interface BoardProps {
  client: PipelineClient;
  columns: BoardColumn[];
  focus: { col: number; idx: number } | null;
  /** Whether to scroll to the highlighted card when it changes (keyboard use); see DealsWorkspace. */
  followFocus: RefObject<boolean>;
  /** Changes when the highlighted card should be scrolled to again ("Show"). */
  reveal: number;
  selection: ReadonlyMap<string, Stage>;
  query: Query;
  now: number;
  actions: DealActions;
  containerRef: RefObject<HTMLDivElement | null>;
  empty: ReactNode;
}

/**
 * One column per stage. Every column is virtualised on its own, so even the
 * "Everyone" board (~10k cards in a column) only mounts what's on screen.
 */
export function BoardView({ client, columns, focus, followFocus, reveal, selection, query, now, actions, containerRef, empty }: BoardProps) {
  const focusedId = focus ? columns[focus.col]?.ids[focus.idx] : undefined;
  const total = columns.reduce((n, c) => n + c.count, 0);
  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Deals board"
      aria-multiselectable
      aria-activedescendant={focusedId ? `deal-${focusedId}` : undefined}
      tabIndex={0}
      className="flex min-h-0 flex-1 gap-2 overflow-x-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {total === 0 && (
        <div className="absolute inset-x-0 mt-24 text-center text-sm text-muted-foreground">{empty}</div>
      )}
      {columns.map((c, i) => (
        <Column
          key={c.stage}
          column={c}
          index={i}
          client={client}
          focusedIdx={focus?.col === i ? focus.idx : null}
          followFocus={followFocus}
          reveal={reveal}
          selection={selection}
          query={query}
          now={now}
          actions={actions}
        />
      ))}
    </div>
  );
}

function Column(props: {
  column: BoardColumn;
  index: number;
  client: PipelineClient;
  focusedIdx: number | null;
  followFocus: RefObject<boolean>;
  reveal: number;
  selection: ReadonlyMap<string, Stage>;
  query: Query;
  now: number;
  actions: DealActions;
}) {
  const { column, client, focusedIdx, selection, actions } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  // Header checkbox: covers the deals really in this stage (not cards a teammate moved away).
  const own = column.ids.filter((id) => client.getView(id)?.deal.stage === column.stage);
  let picked = 0;
  for (const id of own) if (selection.has(id)) picked++;
  const allPicked = own.length > 0 && picked === own.length;
  const checkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkRef.current) checkRef.current.indeterminate = picked > 0 && !allPicked;
  }, [picked, allPicked]);

  const virtualizer = useVirtualizer({
    count: column.ids.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT + GAP,
    overscan: 6,
  });

  // Follow the highlight into this column and to the card, when it lands on a different deal here and
  // you're using the keyboard. Data changes (teammates, mouse moves) never scroll.
  const focusedId = focusedIdx == null ? null : column.ids[focusedIdx] ?? null;
  const focusedIdxRef = useRef(focusedIdx);
  focusedIdxRef.current = focusedIdx;
  // "Show" (reveal) centres the card, so it's never left under the job tray at the bottom edge.
  const revealRef = useRef(props.reveal);
  useEffect(() => {
    const revealing = revealRef.current !== props.reveal;
    revealRef.current = props.reveal;
    if (focusedId == null || focusedIdxRef.current == null || !props.followFocus.current) return;
    colRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    virtualizer.scrollToIndex(focusedIdxRef.current, { align: revealing ? 'center' : 'auto' });
  }, [focusedId, props.followFocus, props.reveal, virtualizer]);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!over) setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (id) actions.pick(id, column.stage);
  };

  return (
    <div
      ref={colRef}
      role="group"
      aria-label={`${STAGE_LABEL[column.stage]}: ${column.count} deals`}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={onDrop}
      className={cn('flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40 transition-colors', over && 'border-ring bg-accent ring-2 ring-ring/40')}
    >
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-2">
        <label className="flex min-w-0 items-center gap-2" title={allPicked ? `Unselect all in ${STAGE_LABEL[column.stage]}` : `Select all ${fmtNum(own.length)} in ${STAGE_LABEL[column.stage]} (Ctrl/⌘+A)`}>
          <input
            ref={checkRef}
            type="checkbox"
            tabIndex={-1}
            disabled={own.length === 0}
            checked={allPicked}
            onChange={() => actions.selectColumn(column.stage, own, !allPicked)}
            aria-label={`Select all deals in ${STAGE_LABEL[column.stage]}`}
            className="size-3.5 shrink-0 accent-primary"
          />
          <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STAGE_STYLE[column.stage])}>{STAGE_LABEL[column.stage]}</span>
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          <strong className="text-foreground">{fmtNum(column.count)}</strong> · {fmtINRCompact(column.value)}
        </span>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-1.5 pt-2">
        {column.ids.length === 0 ? (
          <div className="mt-6 text-center text-xs text-muted-foreground">{over ? 'Drop to move here' : 'No deals'}</div>
        ) : (
          // id: e.g. document.getElementById('cards-lost').children.length shows how few cards are actually in the page.
          <div id={`cards-${column.stage}`} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const id = column.ids[vi.index];
              const view = client.getView(id);
              if (!view) return null;
              return (
                <DealCard
                  key={id}
                  view={view}
                  top={vi.start}
                  columnStage={column.stage}
                  focused={vi.index === focusedIdx}
                  selected={selection.has(id)}
                  selecting={selection.size > 0}
                  dim={!matches(view.deal, props.query, props.now)}
                  me={client.me}
                  now={props.now}
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

interface CardProps {
  view: DealView;
  top: number;
  columnStage: Stage;
  focused: boolean;
  selected: boolean;
  /** Anything is selected: every card shows its checkbox ("selection mode"). */
  selecting: boolean;
  dim: boolean;
  me: string;
  now: number;
  actions: DealActions;
}

const DealCard = memo(function DealCard({ view, top, columnStage, focused, selected, selecting, dim, me, now, actions }: CardProps) {
  const d = view.deal;
  const pr = prioritize(d, now);
  // A teammate moved it: the card stays where you saw it (no jumping) and says where it went.
  const displaced = d.stage !== columnStage;
  return (
    <div
      id={`deal-${d.id}`}
      role="option"
      aria-selected={selected}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, d.id);
        e.dataTransfer.effectAllowed = 'move';
        actions.setDragging(d.id);
      }}
      onDragEnd={() => actions.setDragging(null)}
      // Can't preventDefault on mousedown (it would block native drag), so hand focus back to the board.
      onMouseDown={() => actions.focusContainer()}
      onClick={(e) => actions.click(d.id, e)}
      className={cn(
        'group absolute inset-x-0 flex cursor-grab flex-col gap-1 rounded-lg border bg-card p-2.5 text-sm shadow-xs active:cursor-grabbing',
        selected && 'border-primary/40 bg-primary/5',
        focused && 'z-[1] outline-2 -outline-offset-1 outline-ring',
        (dim || displaced) && 'opacity-55',
      )}
      style={{ top, height: CARD_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-2">
        <TruncatedText className="min-w-0 flex-1 font-medium">{d.name}</TruncatedText>
        <span className="flex shrink-0 items-center gap-1.5">
          <InitialsAvatar name={d.owner} initials={ownerInitials(d.owner)} label={d.owner === me ? `Owner: ${d.owner} (you)` : `Owner: ${d.owner}`} highlight={d.owner === me} />
          {/* Shown on hover, and on every card once anything is selected. */}
          <input
            type="checkbox"
            tabIndex={-1}
            aria-label={`Select ${d.name}`}
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => actions.toggle(d.id, (e.nativeEvent as unknown as MouseEvent).shiftKey)}
            className={cn('size-3.5 accent-primary', !(selecting || selected) && 'hidden group-hover:block')}
          />
        </span>
      </div>
      <div className="truncate text-xs text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{fmtINR(d.value)}</span> · {d.id}
        {displaced && <> · <span className="font-medium text-foreground">now in {STAGE_LABEL[d.stage]}</span></>}
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <ReasonChips reasons={pr.reasons} max={1} compact />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="min-w-0 flex-1 text-muted-foreground"><UpdatedBy view={view} me={me} now={now} /></span>
        <span className="shrink-0"><SaveStatus view={view} actions={actions} compact /></span>
      </div>
    </div>
  );
});
