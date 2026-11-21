import { describe, expect, it } from 'vitest';
import { applyStored } from './storage';
import { generateDeals } from './seed';
import { FakeServer } from './fakeServer';
import type { Deal } from '@/entities/deal';

const CREATED = new Date('2026-11-01T09:00:00').getTime();

describe('fake server persistence', () => {
  it('regenerates the same base data from the creation time', () => {
    expect(generateDeals(200, CREATED)).toEqual(generateDeals(200, CREATED));
  });

  it('applies stored changes on top of the base data and restores the change counter', () => {
    const base = generateDeals(100, CREATED);
    const changed: Deal[] = [
      { ...base[3], stage: 'lost', version: 2, seq: 7 },
      { ...base[50], value: 1, version: 3, seq: 12 },
    ];
    const { deals, seq } = applyStored(base, changed);
    expect(deals).toHaveLength(100);
    expect(deals[3].stage).toBe('lost');
    expect(deals[50].value).toBe(1);
    expect(deals[4]).toBe(base[4]); // untouched deals are the base objects
    expect(seq).toBe(12); // new writes continue after the last stored one
  });

  it('reports every write for saving, even while "offline" (offline only stops pushes)', async () => {
    const server = new FakeServer(generateDeals(5, CREATED), { config: { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, online: false } });
    const written: Deal[] = [];
    server.onWrite((d) => written.push(d));
    server.teammateEdit('D-00001', 'stage');
    expect(written.map((d) => d.id)).toEqual(['D-00001']);
    expect(written[0].seq).toBe(1);
  });

  it('a restored server keeps numbering changes after the stored ones', () => {
    const base = generateDeals(5, CREATED);
    const { deals, seq } = applyStored(base, [{ ...base[0], stage: 'won', version: 2, seq: 40 }]);
    const server = new FakeServer(deals, { seq });
    const next = server.teammateEdit('D-00002', 'value')!;
    expect(next.seq).toBe(41);
  });
});
