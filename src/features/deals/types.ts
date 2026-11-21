import type { MouseEvent } from 'react';
import type { Query, Stage } from '@/entities/deal';

/** Everything a row or card can ask the page to do. One stable object, so memoised rows don't re-render. */
export interface DealActions {
  click(id: string, e: MouseEvent): void;
  toggle(id: string, shift: boolean): void;
  /** A board column's checkbox: select or unselect the deals really in that stage. */
  selectColumn(stage: Stage, ids: readonly string[], on: boolean): void;
  /** Open (id) or close (null) a deal's stage dropdown. */
  setMenu(id: string | null): void;
  /** A card started (id) or stopped (null) being dragged. */
  setDragging(id: string | null): void;
  /** Stage chosen for a deal (applies to the whole selection if that deal is selected). */
  pick(id: string, stage: Stage): void;
  focusContainer(): void;
  retry(id: string): void;
  discard(id: string): void;
  keepTheirs(id: string): void;
  applyMine(id: string): void;
}

export type Layout = 'board' | 'table';

/** One board column: the deals shown in a stage (in snapshot order) and its totals. */
export interface BoardColumn {
  stage: Stage;
  ids: string[];
  count: number;
  value: number;
}

/**
 * Everything that defines "what I'm looking at" in the deals workspace. The
 * workspace takes it as a prop and reports changes; whoever renders it decides
 * where it lives (the Deals page keeps it in the URL; a dashboard widget could
 * just hard-code one).
 */
export type ViewState = Pick<Query, 'view' | 'scope' | 'stage' | 'search' | 'sort'> & { layout: Layout };
