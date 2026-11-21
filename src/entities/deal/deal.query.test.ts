import { describe, expect, it } from 'vitest';
import { prioritize } from './deal.priority';
import { DEFAULT_SORT, runQuery, summarize, type Query } from './deal.query';
import { generateDeals } from '@mock-server/seed';
import { DAY, OWNERS, ownerInitials, type Deal } from './deal.types';

const NOW = new Date('2026-11-17T10:00:00').getTime();

function d(id: string, p: Partial<Deal>): Deal {
  return {
    id, name: id, licences: 1, value: 100_000, owner: 'Priya', stage: 'demo',
    nextStepAt: null, expectedCloseAt: NOW + 60 * DAY, lastActivityAt: NOW, stageChangedAt: NOW, stageChangedBy: 'x',
    updatedAt: NOW - 3 * DAY, updatedBy: 'x', updatedBySession: 'seed', version: 1, seq: 0, ...p,
  };
}
const rows = (...deals: Deal[]): Deal[] => deals;
const q = (p: Partial<Query>): Query => ({ view: 'today', scope: 'mine', me: 'Priya', stage: null, search: '', sort: DEFAULT_SORT.today, ...p });

describe('priority', () => {
  it('flags overdue follow-ups, closings within a week and idle deals', () => {
    const p = prioritize(d('a', { nextStepAt: NOW - 3 * DAY, expectedCloseAt: NOW + 2 * DAY, lastActivityAt: NOW - 30 * DAY }), NOW);
    expect(p.actionable).toBe(true);
    expect(p.reasons.map((r) => r.kind)).toEqual(['overdue', 'closing', 'idle']);
  });
  it('closed deals are never actionable', () => {
    expect(prioritize(d('a', { stage: 'won', nextStepAt: NOW - DAY }), NOW).actionable).toBe(false);
  });
  it('the most urgent reason sets the tier', () => {
    const tier = (p: Partial<Deal>) => prioritize(d('a', p), NOW).tier;
    expect(tier({ nextStepAt: NOW - DAY, expectedCloseAt: NOW + 2 * DAY })).toBe(1); // overdue beats closing
    expect(tier({ nextStepAt: NOW })).toBe(2);
    expect(tier({ expectedCloseAt: NOW + 5 * DAY })).toBe(3);
    expect(tier({ expectedCloseAt: NOW - 5 * DAY })).toBe(4);
    expect(tier({ lastActivityAt: NOW - 20 * DAY })).toBe(5);
    expect(tier({})).toBe(6);
    expect(tier({ stage: 'lost' })).toBeNull();
  });
  it('Priority sort: tier first, then bigger deals', () => {
    const data = rows(
      d('big-closing', { value: 20_000_000, expectedCloseAt: NOW + 5 * DAY }),
      d('small-overdue', { value: 500_000, nextStepAt: NOW - 2 * DAY }),
      d('due-today', { value: 5_000_000, nextStepAt: NOW }),
      d('bigger-overdue', { value: 900_000, nextStepAt: NOW - DAY }),
    );
    expect(runQuery(data, q({}), NOW)).toEqual(['bigger-overdue', 'small-overdue', 'due-today', 'big-closing']);
  });
});

describe('views and scope', () => {
  const data = rows(
    d('due', { nextStepAt: NOW }),
    d('later', { nextStepAt: NOW + 10 * DAY }),
    d('rahuls', { owner: 'Rahul', nextStepAt: NOW }),
    d('stale', { lastActivityAt: NOW - 120 * DAY }),
    d('lost-stale', { stage: 'lost', lastActivityAt: NOW - 120 * DAY }),
    d('touched', { updatedAt: NOW - 3_600_000 }),
  );

  it('Today = my actionable open deals', () => {
    expect(runQuery(data, q({}), NOW)).toEqual(['due']);
  });
  it('Everyone widens the same view', () => {
    expect(runQuery(data, q({ scope: 'everyone' }), NOW).sort()).toEqual(['due', 'rahuls']);
  });
  it('a specific owner', () => {
    expect(runQuery(data, q({ scope: 'Rahul' }), NOW)).toEqual(['rahuls']);
  });
  it('Stale = open deals idle 90d+', () => {
    expect(runQuery(data, q({ view: 'stale', sort: DEFAULT_SORT.stale }), NOW)).toEqual(['stale']);
  });
  it('My deals and All deals hide nothing: Won and Lost included', () => {
    expect(runQuery(data, q({ view: 'open', sort: DEFAULT_SORT.open }), NOW)).toContain('lost-stale');
    expect(runQuery(data, q({ view: 'all', scope: 'everyone', sort: DEFAULT_SORT.all }), NOW)).toHaveLength(data.length);
  });
  it('search matches name, id and owner', () => {
    expect(runQuery(data, q({ view: 'open', scope: 'everyone', search: 'rahul' }), NOW)).toEqual(['rahuls']);
  });
  it('sort is deterministic on ties', () => {
    const tied = rows(d('b', {}), d('a', {}), d('c', {}));
    expect(runQuery(tied, q({ view: 'open', sort: { key: 'value', dir: 'desc' } }), NOW)).toEqual(['a', 'b', 'c']);
  });
  it('stage bar totals ignore the stage filter; tab counts follow scope', () => {
    const s = summarize(data, q({ view: 'open', stage: 'won' }), NOW);
    expect(s.stages.demo.count).toBe(4);
    expect(s.stages.lost.count).toBe(1);
    expect(s.views.today).toBe(1);
  });
});

describe('scale', () => {
  it('filters and sorts 50,000 deals quickly', () => {
    const deals = generateDeals(50_000, NOW);
    const r = rows(...deals);
    const t = performance.now();
    const ids = runQuery(r, q({ view: 'open', scope: 'everyone', sort: DEFAULT_SORT.open }), NOW);
    const ms = performance.now() - t;
    expect(ids.length).toBeGreaterThan(20_000);
    expect(ms).toBeLessThan(500);
  });
});

describe('owner initials', () => {
  it('are unique within the team', () => {
    expect(new Set(OWNERS.map(ownerInitials)).size).toBe(OWNERS.length);
    expect(ownerInitials('Priya')).toBe('PR');
    expect(ownerInitials('Kavya')).toBe('KA');
    expect(ownerInitials('Karan')).toBe('KR');
  });
});
