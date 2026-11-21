import { DEFAULT_SORT, OWNERS, STAGES, VIEWS, viewDef, type Scope, type SortKey, type Stage, type ViewId } from '@/entities/deal';
import type { Layout, ViewState } from '@/features/deals/types';

/**
 * The view lives in the URL: /deals?layout=table&view=all&whose=rahul&stage=negotiation&q=acme&sort=value-desc
 * Anything missing or invalid falls back to the default below.
 */

/** Where everyone lands: a board of MY deals ("where do I stand?"). */
export const DEFAULT_VIEW: ViewState = {
  layout: 'board',
  view: 'open',
  scope: 'mine',
  stage: null,
  search: '',
  sort: DEFAULT_SORT.open,
};

const SORT_KEYS: SortKey[] = ['priority', 'name', 'stage', 'value', 'owner', 'nextStep', 'close', 'activity', 'updated'];

/** URL → view. Never throws. */
export function parseViewState(params: URLSearchParams): ViewState {
  const layoutParam = params.get('layout');
  const layout: Layout = layoutParam === 'board' || layoutParam === 'table' ? layoutParam : DEFAULT_VIEW.layout;

  const viewParam = params.get('view');
  const view: ViewId = VIEWS.some((v) => v.id === viewParam) ? (viewParam as ViewId) : DEFAULT_VIEW.view;

  // Your views are always yours; only All deals reads the Owner filter (default: anyone).
  const whose = params.get('whose')?.toLowerCase();
  const scope: Scope = viewDef(view).scope === 'mine'
    ? 'mine'
    : whose === 'mine' || whose === 'everyone' ? whose : OWNERS.find((o) => o.toLowerCase() === whose) ?? 'everyone';

  const stageParam = params.get('stage');
  const stage = STAGES.includes(stageParam as Stage) ? (stageParam as Stage) : null;

  const [key, dir] = (params.get('sort') ?? '').split('-');
  const sort = SORT_KEYS.includes(key as SortKey) && (dir === 'asc' || dir === 'desc')
    ? { key: key as SortKey, dir: dir as 'asc' | 'desc' }
    : DEFAULT_SORT[view];

  return { layout, view, scope, stage, search: params.get('q') ?? '', sort };
}

/** View → URL params. Other params (e.g. ?user=) are kept; the sort is only written if it isn't the view's default. */
export function writeViewState(params: URLSearchParams, s: ViewState): URLSearchParams {
  const out = new URLSearchParams(params);
  const set = (k: string, v: string | null) => (v ? out.set(k, v) : out.delete(k));
  set('layout', s.layout);
  set('view', s.view);
  set('whose', viewDef(s.view).scope === 'mine' ? null : s.scope);
  set('stage', s.stage);
  set('q', s.search || null);
  const d = DEFAULT_SORT[s.view];
  set('sort', s.sort.key === d.key && s.sort.dir === d.dir ? null : `${s.sort.key}-${s.sort.dir}`);
  return out;
}

/** Changes to these get their own browser-history entry (Back returns to the previous view); search and sort don't. */
export const isNavigation = (a: ViewState, b: ViewState) =>
  a.layout !== b.layout || a.view !== b.view || a.scope !== b.scope || a.stage !== b.stage;
