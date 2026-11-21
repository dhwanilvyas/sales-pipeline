import { describe, expect, it } from 'vitest';
import { DAY, DEFAULT_SORT, type Deal, type Query, type Stage } from '@/entities/deal';
import { liveRows } from './liveRows';

const NOW = new Date('2026-11-17T10:00:00').getTime();
const deal = (id: string, owner = 'Priya', stage: Stage = 'demo'): Deal => ({
  id, name: id, licences: 1, value: 1000, owner, stage, nextStepAt: null, expectedCloseAt: NOW + 30 * DAY,
  lastActivityAt: NOW, stageChangedAt: NOW, stageChangedBy: 'x', updatedAt: NOW, updatedBy: 'Rahul', updatedBySession: 'r', version: 2, seq: 1,
});
const myDeals: Query = { view: 'open', scope: 'mine', me: 'Priya', stage: null, search: '', sort: DEFAULT_SORT.open };

describe('live rows (views of your own deals)', () => {
  const deals = new Map([['a', deal('a')], ['b', deal('b', 'Rahul')], ['c', deal('c')]]);
  const get = (id: string) => deals.get(id);

  it('a deal reassigned away leaves; one reassigned to me joins at the top', () => {
    expect(liveRows(['a', 'b'], ['b', 'c'], get, myDeals, NOW, new Set())).toEqual(['c', 'a']);
  });
  it("a deal I'm dragging (or whose menu is open) doesn't leave until I let go", () => {
    expect(liveRows(['a', 'b'], ['b'], get, myDeals, NOW, new Set(['b']))).toEqual(['a', 'b']);
  });
  it('nothing changed: the same array, so nothing re-renders', () => {
    const snap = ['a', 'b'];
    expect(liveRows(snap, ['a'], get, myDeals, NOW, new Set())).toBe(snap);
  });
});
