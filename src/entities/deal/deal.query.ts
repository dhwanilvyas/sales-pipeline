import { prioritize } from './deal.priority';
import { DAY, STAGES, isOpen, type Deal, type Stage } from './deal.types';

export type ViewId = 'open' | 'today' | 'stale' | 'all';

/** Whose deals you're viewing: 'mine', 'everyone', or a specific owner name. */
export type Scope = 'mine' | 'everyone' | (string & {});

/**
 * Preset views for the demo: your own views first, then everyone's deals. Your views are fixed to
 * your deals (`scope`); only All deals has the Owner filter. In a full product users would filter
 * All deals and save the result as their own views.
 */
export const VIEWS: { id: ViewId; label: string; key: string; scope: Scope; hint: string }[] = [
  { id: 'open', label: 'My deals', key: 'p', scope: 'mine', hint: 'All your deals, by stage' },
  { id: 'today', label: 'Follow up today', key: 't', scope: 'mine', hint: 'Overdue follow-ups, follow-ups due today and deals closing this week. Most urgent first.' },
  { id: 'stale', label: 'Gone quiet', key: 'q', scope: 'mine', hint: 'No activity for 90+ days. Revive or close them (quarter-end cleanup).' },
  { id: 'all', label: 'All deals', key: 'a', scope: 'everyone', hint: "Everyone's deals, by stage" },
];

export const viewDef = (id: ViewId) => VIEWS.find((v) => v.id === id)!;

/** The Owner filter's label: "Me", "Anyone" or the teammate's name. */
export const scopeLabel = (scope: Scope) => (scope === 'mine' ? 'Me' : scope === 'everyone' ? 'Anyone' : scope);

export type SortKey = 'priority' | 'name' | 'stage' | 'value' | 'owner' | 'nextStep' | 'close' | 'activity' | 'updated';
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }

export const DEFAULT_SORT: Record<ViewId, Sort> = {
  today: { key: 'priority', dir: 'desc' },
  open: { key: 'priority', dir: 'desc' },
  stale: { key: 'activity', dir: 'asc' },
  all: { key: 'priority', dir: 'desc' },
};

export interface Query {
  view: ViewId;
  scope: Scope;
  me: string;
  stage: Stage | null;
  search: string;
  sort: Sort;
}

export const STALE_DAYS = 90;

function inView(d: Deal, view: ViewId, now: number): boolean {
  switch (view) {
    case 'today': return prioritize(d, now).actionable;
    // The defaults hide nothing: Won and Lost stay visible (moving a deal there never makes it vanish).
    case 'open':
    case 'all': return true;
    case 'stale': return isOpen(d.stage) && d.lastActivityAt < now - STALE_DAYS * DAY;
  }
}

function inScope(d: Deal, scope: Scope, me: string): boolean {
  if (scope === 'everyone') return true;
  if (scope === 'mine') return d.owner === me;
  return d.owner === scope;
}

/** View + scope + search (stage filter ignored — used by the stage bar). */
export function matchesBase(d: Deal, q: Query, now: number): boolean {
  if (!inScope(d, q.scope, q.me)) return false;
  if (!inView(d, q.view, now)) return false;
  if (q.search) {
    const s = q.search.toLowerCase();
    if (!d.name.toLowerCase().includes(s) && !d.id.toLowerCase().includes(s) && !d.owner.toLowerCase().includes(s)) return false;
  }
  return true;
}

export function matches(d: Deal, q: Query, now: number): boolean {
  return (!q.stage || d.stage === q.stage) && matchesBase(d, q, now);
}

/**
 * Priority as one sortable number (higher = more urgent): the tier first, then
 * the deal's value. Values stay far below 1e12, so a tier always outranks value.
 */
function priorityKey(d: Deal, now: number): number {
  const { tier } = prioritize(d, now);
  return tier === null ? d.value : (7 - tier) * 1e12 + d.value;
}

const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;

function sortValue(d: Deal, key: SortKey, now: number): number | string {
  switch (key) {
    case 'priority': return priorityKey(d, now);
    case 'name': return d.name;
    case 'stage': return STAGE_INDEX[d.stage];
    case 'value': return d.value;
    case 'owner': return d.owner;
    case 'nextStep': return d.nextStepAt ?? Number.MAX_SAFE_INTEGER;
    case 'close': return d.expectedCloseAt;
    case 'activity': return d.lastActivityAt;
    case 'updated': return d.updatedAt;
  }
}

/**
 * Filter + sort into an ordered id list. The UI calls this only when the user
 * changes the query or asks to refresh, so background edits never reorder rows
 * under the user's cursor. Ties break on id so order is deterministic.
 */
export function runQuery(deals: Iterable<Deal>, q: Query, now: number): string[] {
  const keyed: { id: string; v: number | string }[] = [];
  for (const d of deals) {
    if (matches(d, q, now)) keyed.push({ id: d.id, v: sortValue(d, q.sort.key, now) });
  }
  const dir = q.sort.dir === 'asc' ? 1 : -1;
  keyed.sort((a, b) => {
    if (a.v < b.v) return -dir;
    if (a.v > b.v) return dir;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return keyed.map((k) => k.id);
}

export interface StageTotals { count: number; value: number }

/** Stage bar + tab counts in one pass over the data. */
export function summarize(deals: Iterable<Deal>, q: Query, now: number) {
  const stages = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }])) as Record<Stage, StageTotals>;
  // Your views count your deals; All deals counts with its Owner filter (everyone unless you're on it).
  const views: Record<ViewId, number> = { open: 0, today: 0, stale: 0, all: 0 };
  const scopes = VIEWS.map((v) => ({ id: v.id, scope: v.id === q.view ? q.scope : v.scope }));
  for (const d of deals) {
    if (matchesBase(d, q, now)) {
      const t = stages[d.stage];
      t.count++;
      t.value += d.value;
    }
    for (const v of scopes) if (inScope(d, v.scope, q.me) && inView(d, v.id, now)) views[v.id]++;
  }
  return { stages, views };
}
