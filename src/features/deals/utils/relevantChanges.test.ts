import { describe, expect, it } from 'vitest';
import { DAY, DEFAULT_SORT, type Deal, type Query } from '@/entities/deal';
import { relevantChange } from './relevantChanges';

const NOW = new Date('2026-11-17T10:00:00').getTime();
const deal = (id: string, owner: string): Deal => ({
  id, name: id, licences: 1, value: 100_000, owner, stage: 'demo',
  nextStepAt: null, expectedCloseAt: NOW + 60 * DAY, lastActivityAt: NOW, stageChangedAt: NOW, stageChangedBy: 'x',
  updatedAt: NOW, updatedBy: 'Rahul', updatedBySession: 'other', version: 2, seq: 1,
});
const myDeals: Query = { view: 'open', scope: 'mine', me: 'Priya', stage: null, search: '', sort: DEFAULT_SORT.open };

describe('relevantChange', () => {
  const deals = new Map([
    ['acme', deal('acme', 'Priya')], // on my board, Rahul moved it
    ['rahuls', deal('rahuls', 'Rahul')], // Rahul's own deal
    ['handed', deal('handed', 'Priya')], // just reassigned to me, not on screen yet
    ['taken', deal('taken', 'Rahul')], // was on my board, reassigned away
  ]);
  const onScreen = new Set(['acme', 'taken']);
  const isRelevant = relevantChange(onScreen, (id) => deals.get(id), myDeals, NOW);

  it("on My deals, counts changes to my deals, not to other people's", () => {
    expect(isRelevant('acme')).toBe(true);
    expect(isRelevant('rahuls')).toBe(false);
  });
  it('counts deals entering or leaving the view', () => {
    expect(isRelevant('handed')).toBe(true);
    expect(isRelevant('taken')).toBe(true);
  });
  it('on All deals, every change counts', () => {
    const all = relevantChange(new Set(), (id) => deals.get(id), { ...myDeals, view: 'all', scope: 'everyone' }, NOW);
    expect([...deals.keys()].every(all)).toBe(true);
  });
});
