import { describe, expect, it } from 'vitest';
import { groupConflicts } from './conflicts';

const theirs = (by: string, stage: 'lost' | 'won', at: number) => ({ by, stage, at, self: false });

describe('groupConflicts', () => {
  it('groups by who moved them and where, biggest group first', () => {
    const groups = groupConflicts([
      { id: 'a', wanted: 'proposal', theirs: theirs('Kavya', 'won', 1) },
      { id: 'b', wanted: 'proposal', theirs: theirs('Rahul', 'lost', 2) },
      { id: 'c', wanted: 'demo', theirs: theirs('Rahul', 'lost', 5) },
    ]);
    expect(groups.map((g) => [g.by, g.stage, g.ids])).toEqual([['Rahul', 'lost', ['b', 'c']], ['Kavya', 'won', ['a']]]);
    expect(groups[0].wanted).toEqual({ proposal: 1, demo: 1 });
    expect(groups[0].latestAt).toBe(5);
  });
});
