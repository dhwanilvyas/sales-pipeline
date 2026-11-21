import { describe, expect, it } from 'vitest';
import { notInView, clampIndex, selectAll, selectRange, toggle, inStage, setMany } from './selection';
import { type Stage } from '@/entities/deal';

const ids = ['a', 'b', 'c', 'd', 'e'];
const stages: Record<string, Stage> = { a: 'new', b: 'demo', c: 'demo', d: 'won', e: 'lost' };
const stageOf = (id: string) => stages[id];

describe('selection', () => {
  it('toggle adds with the stage at selection time, and removes', () => {
    const s1 = toggle(new Map(), 'b', 'demo');
    expect([...s1]).toEqual([['b', 'demo']]);
    expect(toggle(s1, 'b', 'demo').size).toBe(0);
  });
  it('range works in both directions and keeps existing picks', () => {
    const base = toggle(new Map(), 'a', 'new');
    expect([...selectRange(base, ids, 3, 1, stageOf).keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('range is clamped to the list', () => {
    expect(selectRange(new Map(), ids, -5, 99, stageOf).size).toBe(5);
  });
  it('select all covers the whole filtered list, not just visible rows', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `x${i}`);
    expect(selectAll(many, () => 'demo').size).toBe(10_000);
  });
  it('clampIndex', () => {
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe('column selection', () => {
  const stages: Record<string, Stage> = { a: 'contacted', b: 'contacted', c: 'lost', d: 'contacted' };
  const stageOf = (id: string) => stages[id];

  it('inStage leaves out cards a teammate already moved to another stage', () => {
    expect(inStage(['a', 'b', 'c', 'd'], 'contacted', stageOf)).toEqual(['a', 'b', 'd']);
  });

  it('setMany adds with the current stage, and removes', () => {
    const on = setMany(new Map([['x', 'new' as Stage]]), ['a', 'c'], stageOf, true);
    expect([...on]).toEqual([['x', 'new'], ['a', 'contacted'], ['c', 'lost']]);
    expect([...setMany(on, ['a', 'x'], stageOf, false)]).toEqual([['c', 'lost']]);
  });
});

describe('selection vs. a rebuilt list', () => {
  it('notInView finds selected deals that dropped out of the view', () => {
    const sel = new Map<string, Stage>([['a', 'new'], ['b', 'demo'], ['c', 'demo']]);
    expect(notInView(sel, ['a', 'c', 'z'])).toEqual(['b']);
    expect(notInView(new Map(), ['a'])).toEqual([]);
  });
});
