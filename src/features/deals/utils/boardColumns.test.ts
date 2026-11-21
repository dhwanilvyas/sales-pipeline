import { describe, expect, it } from 'vitest';
import { buildColumns } from './boardColumns';
import { type Deal, type Stage } from '@/entities/deal';
import type { DealView, SaveStatus } from '@/features/deals/api/pipelineClient';

const deal = (id: string, stage: Stage, session = 'seed', by = 'x'): Deal => ({
  id, name: id, licences: 1, value: 1000, owner: 'Priya', stage, nextStepAt: null, expectedCloseAt: 0,
  lastActivityAt: 0, stageChangedAt: 0, stageChangedBy: by, updatedAt: 0, updatedBy: by, updatedBySession: session, version: 1, seq: 0,
});
const view = (d: Deal, status: SaveStatus | null = null): DealView => ({ deal: d, serverStage: d.stage, status, external: false });

describe('board columns', () => {
  const snapshot = new Map<string, Stage>([['a', 'new'], ['b', 'new'], ['c', 'demo']]);

  it('groups by the snapshot stage, keeping snapshot order', () => {
    const views = { a: view(deal('a', 'new')), b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'new')!.ids).toEqual(['a', 'b']);
    expect(cols.find((c) => c.stage === 'demo')).toMatchObject({ ids: ['c'], count: 1, value: 1000 });
    expect(cols).toHaveLength(7);
  });

  it('my move (pending) jumps to the top of the new column immediately', () => {
    const views = { a: view(deal('a', 'new')), b: view(deal('b', 'demo'), 'saving'), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'demo')!.ids).toEqual(['b', 'c']);
    expect(cols.find((c) => c.stage === 'new')!.ids).toEqual(['a']);
  });

  it("live views (your own deals): a teammate's move moves the card, unless you're dragging it or its menu is open", () => {
    const views = { a: view(deal('a', 'won', 'rahul-tab', 'Rahul')), b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const live = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya', { hold: new Set() });
    expect(live.find((c) => c.stage === 'won')!.ids).toEqual(['a']);
    const held = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya', { hold: new Set(['a']) });
    expect(held.find((c) => c.stage === 'new')!.ids).toEqual(['a', 'b']);
    const shared = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(shared.find((c) => c.stage === 'new')!.ids).toEqual(['a', 'b']); // All deals: waits for Apply
  });

  it('a teammate change I accepted ("Keep theirs") goes to its real column at once, not dimmed', () => {
    const views = { a: { ...view(deal('a', 'won', 'rahul-tab', 'Rahul')), accepted: true }, b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'won')!.ids).toEqual(['a']);
  });

  it('my saved move (last change from this tab) also stays in its new column', () => {
    const views = { a: view(deal('a', 'won', 'me')), b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'won')!.ids).toEqual(['a']);
  });

  it('my move from another tab of mine moves the card too', () => {
    const views = { a: view(deal('a', 'won', 'my-other-tab', 'Priya')), b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'won')!.ids).toEqual(['a']);
  });

  it("a teammate's move does not move the card until refresh", () => {
    const views = { a: view(deal('a', 'lost', 'rahul-tab')), b: view(deal('b', 'new')), c: view(deal('c', 'demo')) };
    const cols = buildColumns(['a', 'b', 'c'], snapshot, (id) => views[id as 'a'], 'me', 'Priya');
    expect(cols.find((c) => c.stage === 'new')!.ids).toEqual(['a', 'b']);
    expect(cols.find((c) => c.stage === 'lost')!.ids).toEqual([]);
  });
});
