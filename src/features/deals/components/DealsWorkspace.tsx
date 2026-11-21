import type { RemoteChange } from '@/features/deals/api/pipelineClient';
import { toast } from 'sonner';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useShell } from '@/shared/hooks/useShell';
import { plural } from '@/shared/utils/format';
import { useNow } from '@/shared/hooks/useNow';
import { BoardView, CARD_STEP } from './BoardView';
import { BulkBar } from './BulkBar';
import { LayoutSwitch } from './LayoutSwitch';
import { PipelineSelect } from './PipelineSelect';
import { StageBar } from './StageBar';
import { Toolbar } from './Toolbar';
import { ViewBar } from './ViewBar';
import { StagePicker } from './StagePicker';
import { DealPeek } from './DealPeek';
import { UpdatesMenu } from './UpdatesMenu';
import { useTeammateToasts } from '@/features/deals/hooks/useTeammateToasts';
import { JobDetailsPanel } from './JobDetailsPanel';
import { ChangeDetailsPanel, changeTitle } from './ChangeDetailsPanel';
import { UnsavedPanel } from './UnsavedPanel';
import { clampIndex } from '@/features/deals/utils/selection';
import { ROW_HEIGHT, TableView } from './TableView';
import type { DealActions, Layout, ViewState } from '@/features/deals/types';
import { DEFAULT_SORT, viewDef, type Query, type SortKey, type ViewId } from '@/entities/deal';
import { useDealRows } from '@/features/deals/hooks/useDealRows';
import { useSelection } from '@/features/deals/hooks/useSelection';
import { useDealCommands } from '@/features/deals/hooks/useDealCommands';
import { useShortcuts } from '@/features/deals/hooks/useShortcuts';
import { useDealClient } from '@/features/deals/api/DealClientProvider';

const EMPTY_TEXT: Record<ViewId, string> = {
  today: 'Nothing urgent today. No follow-ups due and nothing closing this week.',
  open: 'No deals here.',
  stale: 'No stale deals. The pipeline is clean.',
  all: 'No deals.',
};

export interface DealsWorkspaceProps {
  /** What to show. The workspace never stores it; it reports changes through onViewChange. */
  view: ViewState;
  onViewChange(patch: Partial<ViewState>): void;
}

/**
 * The deals workspace: board or table of deals with selection, bulk moves,
 * keyboard control and live updates. Knows nothing about URLs or routes.
 */
export function DealsWorkspace({ view: vs, onViewChange }: DealsWorkspaceProps) {
  const client = useDealClient();
  const user = client.me;
  const shell = useShell();
  const query = useMemo<Query>(
    () => ({ view: vs.view, scope: vs.scope, stage: vs.stage, search: vs.search, sort: vs.sort, me: user }),
    [vs.view, vs.scope, vs.stage, vs.search, vs.sort, user],
  );
  const layout = vs.layout;
  const now = useNow(30_000);

  // ---- what's on screen (snapshot order, columns, counts) ----
  /** Stage dropdown open on this deal (row/card). */
  const [menuId, setMenuId] = useState<string | null>(null);
  /** The card being dragged. */
  const [dragging, setDragging] = useState<string | null>(null);
  // In live views a deal you're dragging, or whose menu is open, isn't moved by others' changes until you let go.
  const hold = useMemo(() => new Set([menuId, dragging].filter((id): id is string => !!id)), [menuId, dragging]);
  const rows = useDealRows(client, query, layout, now, hold);
  const { rowIds, columns, lists, posOf, sums } = rows;

  // ---- the highlighted deal: stored by id, its position derived from the lists ----
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const firstPos = () => {
    const col = lists.findIndex((l) => l.length > 0);
    return col < 0 ? null : { col, idx: 0 };
  };
  const pos = (focusedId && posOf.get(focusedId)) || firstPos();
  const currentId = pos ? lists[pos.col][pos.idx] : null;
  /**
   * Should the board scroll to keep the highlighted card in view? Yes while you use the keyboard
   * (arrows, 1–7 moving the card to another column); no after clicks, drags or teammates' changes,
   * so a position you scrolled to yourself is never reset.
   */
  const followFocus = useRef(true);
  // A teammate moved the highlighted deal (live views): the highlight goes with it, but the board
  // doesn't scroll after it. Set during render, because the columns' scroll effects run before ours.
  const focusSeen = useRef<{ id: string; version: number } | null>(null);
  const focusDeal = currentId ? client.getView(currentId)?.deal : undefined;
  if (focusDeal && focusSeen.current?.id === focusDeal.id && focusSeen.current.version !== focusDeal.version && focusDeal.updatedBySession !== client.session) {
    followFocus.current = false;
  }
  focusSeen.current = focusDeal ? { id: focusDeal.id, version: focusDeal.version } : null;
  /** Bumped to scroll to the highlighted card again, even if it's already the highlighted one. */
  const [reveal, setReveal] = useState(0);
  /** Deal shown in the side panel (over the list; doesn't move it). */
  const [peekId, setPeekId] = useState<string | null>(null);
  /** "View" on a notification: exactly what someone changed on my deals. */
  const [changeDetails, setChangeDetails] = useState<{ title: string; items: RemoteChange[] } | null>(null);
  /** "Show" (job details, Unsaved panel, move toast): highlight and scroll to it, or open its panel if it's not in this view. */
  const showDeal = (id: string) => {
    if (posOf.has(id)) { followFocus.current = true; setFocusedId(id); setReveal((r) => r + 1); }
    else setPeekId(id);
  };

  // ---- selection and commands ----
  const sel = useSelection(client, rows, query);
  const { selection } = sel;
  const cmd = useDealCommands(client, sel, currentId, showDeal);

  // Someone changed one of my deals: tell me who did what (in live views the board has already moved).
  useTeammateToasts(client, rows.rev, rows.live, rows.refresh, setChangeDetails);

  // ---- overlays ----
  /** Centred picker for multi-selections; single deals use the dropdown on their row/card. */
  const [picker, setPicker] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusContainer = () => containerRef.current?.focus({ preventScroll: true });

  useEffect(() => containerRef.current?.focus({ preventScroll: true }), [layout]);

  // Changing what's shown (incl. Back/Forward) drops the selection, so a bulk
  // action can never hit deals you can no longer see.
  useEffect(() => {
    sel.clear();
    cmd.cancelConfirm();
  }, [vs.view, vs.scope, vs.stage, vs.search]); // sel/cmd functions are stable

  // ---- view changes ----
  const updateVs = useCallback((patch: Partial<ViewState>) => {
    onViewChange(patch);
    cmd.cancelConfirm();
  }, [onViewChange, cmd.cancelConfirm]);
  const changeView = useCallback(
    (view: ViewId) => updateVs({ view, scope: viewDef(view).scope, sort: DEFAULT_SORT[view] }),
    [updateVs],
  );
  const changeSort = (key: SortKey) => {
    const cur = vs.sort;
    onViewChange({
      sort: cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'owner' || key === 'nextStep' || key === 'close' ? 'asc' : 'desc' },
    });
  };
  const setLayout = (l: Layout) => updateVs({ layout: l });

  // What cards and rows can do. Everything it uses is stable, so memoised cards don't re-render.
  const actions = useMemo<DealActions>(() => ({
    click(id, e: MouseEvent) {
      sel.click(id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey });
      setFocusedId(id);
      containerRef.current?.focus({ preventScroll: true });
    },
    toggle(id, shift) {
      sel.checkbox(id, shift);
      setFocusedId(id);
    },
    selectColumn: sel.selectColumn,
    setMenu(id) {
      if (id) setFocusedId(id);
      setMenuId(id);
    },
    setDragging,
    pick: (id, stage) => cmd.moveTo(stage, id),
    focusContainer: () => containerRef.current?.focus({ preventScroll: true }),
    retry: (id) => client.retry(id),
    discard: (id) => client.discard(id),
    keepTheirs: (id) => client.keepTheirs(id),
    applyMine: (id) => client.applyMine(id),
  }), [client, sel.click, sel.checkbox, sel.selectColumn, cmd.moveTo]); // all stable

  // ---- keyboard: the key map lives in useShortcuts; these are the commands ----
  const pageSize = () => Math.max(1, Math.floor((containerRef.current?.clientHeight ?? 600) / (layout === 'board' ? CARD_STEP : ROW_HEIGHT)) - 1);
  const focusAt = (col: number, idx: number, extend: boolean) => {
    const list = lists[col];
    if (!list?.length) return;
    const id = list[clampIndex(idx, list.length)];
    if (extend) sel.extendTo(id, currentId);
    else sel.moveAnchor(id);
    setFocusedId(id);
    if (document.activeElement !== containerRef.current) focusContainer();
  };
  useShortcuts({
    enabled: !(shell.overlayOpen || shell.reviewOpen || shell.jobDetailsId || changeDetails || picker || menuId || peekId),
    container: containerRef,
    confirm: cmd.confirm ? { accept: cmd.confirmBulk, cancel: cmd.cancelConfirm } : null,
    navigate(move, extend) {
      const col = pos?.col ?? 0, idx = pos?.idx ?? 0;
      const to = { down: idx + 1, up: idx - 1, pageDown: idx + pageSize(), pageUp: idx - pageSize(), home: 0, end: Number.MAX_SAFE_INTEGER }[move];
      focusAt(col, to, extend);
    },
    column(dir) {
      if (layout !== 'board' || !pos) return;
      for (let c = pos.col + dir; c >= 0 && c < lists.length; c += dir) {
        if (lists[c].length) return focusAt(c, pos.idx, false); // nearest non-empty column, same height
      }
    },
    toggleSelect() {
      if (currentId) sel.toggle(currentId);
    },
    selectAll: () => sel.selectAllStep(columns ? (pos?.col ?? null) : null),
    clearSelection: sel.clear,
    moveToStage: (stage) => cmd.moveTo(stage),
    stepStage: cmd.step,
    openStageMenu() {
      // Board cards have no stage dropdown (the column is the stage), so the board uses the picker.
      if (selection.size > 1 || (columns && currentId)) setPicker(true);
      else if (currentId) setMenuId(currentId);
    },
    openPanel() {
      if (!currentId) return false;
      setPeekId(currentId);
      return true;
    },
    undo: cmd.undo,
    retry: cmd.retry,
    retryAll: () => client.retryAll(),
    stopJob: () => {
      const job = client.stopRunningJob();
      if (job) toast('Stopping…', { id: `cancel-${job.id}`, description: `${job.label}: deals not done yet will be skipped. Already moved ones stay moved (Undo puts them back).` });
      else toast('No bulk job is running', { id: 'no-job' });
    },
    keepTheirs: cmd.keepTheirs,
    applyMine: cmd.applyMine,
    search() {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
    applyChanges: rows.refresh,
    toggleLayout: () => setLayout(layout === 'board' ? 'table' : 'board'),
    toggleScope: () => { if (vs.view === 'all') updateVs({ scope: vs.scope === 'mine' ? 'everyone' : 'mine' }); },
    showView: changeView,
    filterStage: (stage) => updateVs({ stage }),
    review: shell.openReview,
    help: shell.openHelp,
    simulator: shell.openSim,
  });

  // ---- render ----
  const empty = vs.search || vs.stage ? 'No deals match these filters.' : EMPTY_TEXT[vs.view];
  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 px-4 py-3"
      onKeyDownCapture={() => (followFocus.current = true)}
      onPointerDownCapture={() => (followFocus.current = false)}
    >
      {shell.titleSlot && createPortal(<PipelineSelect />, shell.titleSlot)}
      <ViewBar query={query} counts={sums.views} onView={changeView} end={<LayoutSwitch layout={layout} onLayout={setLayout} />} />
      {layout === 'table' && <StageBar totals={sums.stages} active={vs.stage} onStage={(s) => updateVs({ stage: s })} />}
      <Toolbar
        query={query}
        count={rowIds.length}
        updates={<UpdatesMenu client={client} count={rows.pendingUpdates} isRelevant={rows.isRelevant} now={now} onOpenDeal={setPeekId} onOpenChange={(c) => setChangeDetails({ title: changeTitle(c), items: [c] })} onRefresh={rows.refresh} />}
        searchRef={searchRef}
        onSearch={(search) => updateVs({ search })}
        onScope={(scope) => updateVs({ scope })}
        onSort={changeSort}
        onSearchExit={focusContainer}
      />
      <BulkBar
        selected={selection.size}
        bulkBlocked={!client.canEdit()}
        inView={rowIds.length}
        issues={sel.issues}
        confirm={cmd.confirm ? { target: cmd.confirm.target, count: cmd.confirm.entries.length } : null}
        onSelectAll={sel.selectAll}
        onMove={(s) => cmd.moveTo(s)}
        onConfirm={cmd.confirmBulk}
        onCancelConfirm={cmd.cancelConfirm}
        onRetry={cmd.retry}
        onKeepTheirs={cmd.keepTheirs}
        onApplyMine={cmd.applyMine}
        onClear={sel.clear}
      />
      {columns ? (
        <BoardView
          client={client}
          columns={columns}
          focus={pos}
          followFocus={followFocus}
          reveal={reveal}
          selection={selection}
          query={query}
          now={now}
          actions={actions}
          containerRef={containerRef}
          empty={empty}
        />
      ) : (
        <TableView
          client={client}
          rowIds={rowIds}
          focusedIndex={pos?.idx ?? 0}
          reveal={reveal}
          selection={selection}
          menuId={menuId}
          query={query}
          now={now}
          actions={actions}
          onSort={changeSort}
          containerRef={containerRef}
          empty={empty}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {layout === 'board' ? '←→ columns · ↑↓ cards · drag or 1–7 to move' : '↑↓ / j k move · 1–7 move to stage'} · x select · z undo · b {layout === 'board' ? 'table' : 'board'} · ? all shortcuts
      </p>
      <DealPeek
        client={client}
        id={peekId}
        now={now}
        actions={actions}
        inList={!!peekId && posOf.has(peekId)}
        onMove={cmd.moveOne /* the panel is about ONE deal, even if it happens to be selected */}
        onShowInList={(id) => { setPeekId(null); showDeal(id); }}
        onClose={() => setPeekId(null)}
      />
      <UnsavedPanel
        client={client}
        open={shell.reviewOpen}
        now={now}
        onClose={shell.closeReview}
        onResolveGroup={cmd.resolveGroup}
        onShowDeal={(id) => { shell.closeReview(); showDeal(id); }}
      />
      <ChangeDetailsPanel client={client} changes={changeDetails} now={now} onClose={() => setChangeDetails(null)} onShowDeal={(id) => { setChangeDetails(null); showDeal(id); }} />
      {/* Keyed so each opening gets a fresh list (its virtualizer binds to the panel's own scroll area). */}
      <JobDetailsPanel key={shell.jobDetailsId ?? 'closed'} client={client} jobId={shell.jobDetailsId} onClose={shell.closeJobDetails} onShowDeal={(id) => { shell.closeJobDetails(); showDeal(id); }} />
      <StagePicker
        open={picker}
        title={selection.size > 1 ? plural(selection.size, 'selected deal') : (currentId && client.getView(currentId)?.deal.name) || ''}
        current={selection.size > 1 ? null : (currentId && client.getView(currentId)?.deal.stage) || null}
        onPick={(s) => { setPicker(false); cmd.moveTo(s); focusContainer(); }}
        onClose={() => { setPicker(false); focusContainer(); }}
      />
    </main>
  );
}
