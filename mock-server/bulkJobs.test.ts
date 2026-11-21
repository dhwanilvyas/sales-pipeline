import { describe, expect, it } from 'vitest';
import { FakeServer } from './fakeServer';
import { mulberry32 } from './seed';
import { DEFAULT_SORT, MAX_MOVE_ITEMS, type Deal, type Query, type Stage } from '@/entities/deal';

const NOW = new Date('2026-11-17T10:00:00').getTime();
const QUIET = { latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, itemFailureRate: 0, pushDelayMaxMs: 0, teammateEditsPerSec: 0 };
const priya = { user: 'Priya', session: 'tab-1' };
const rahul = { user: 'Rahul', session: 'tab-r' };
const allMine: Query = { view: 'open', scope: 'mine', me: 'Priya', stage: null, search: '', sort: DEFAULT_SORT.open };

function deal(i: number, owner = 'Priya', stage: Stage = 'demo'): Deal {
  return {
    id: `D-${i}`, name: `Deal ${i}`, licences: 1, value: 1000, owner, stage,
    nextStepAt: null, expectedCloseAt: NOW, lastActivityAt: NOW, stageChangedAt: NOW, stageChangedBy: 'x',
    updatedAt: NOW, updatedBy: 'seed', updatedBySession: 'seed', version: 1, seq: 0,
  };
}
function setup(config = {}) {
  const deals = [deal(0), deal(1), deal(2), deal(3, 'Rahul')];
  return new FakeServer(deals, { config: { ...QUIET, ...config }, random: mulberry32(3), now: () => NOW });
}
async function finished(server: FakeServer, jobId: string) {
  for (let i = 0; i < 200; i++) {
    const j = (await server.bulkJobs('Priya')).find((x) => x.id === jobId);
    if (j?.finished) return j;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error('job never finished');
}
const outcomes = (j: { results: { id: string; outcome: string }[] }) => Object.fromEntries(j.results.map((r) => [r.id, r.outcome]));

describe('bulk jobs (server)', () => {
  it('moves every deal matching the filter, found by the server itself', async () => {
    const server = setup();
    const job = await server.startBulkMove({ key: 'k1', label: 'All mine to Lost', filter: allMine, target: 'lost' }, priya);
    expect(job.deals.map((d) => d.id)).toEqual(['D-0', 'D-1', 'D-2']); // not Rahul's D-3
    expect(outcomes(await finished(server, job.id))).toEqual({ 'D-0': 'ok', 'D-1': 'ok', 'D-2': 'ok' });
    expect(server.peek('D-1')!.stage).toBe('lost');
  });

  it('a deal someone changes after the job started is skipped, not overwritten', async () => {
    const server = setup({ latencyMinMs: 5, latencyMaxMs: 5 });
    const job = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    server.teammateEdit('D-2', 'owner'); // no longer "mine"
    const done = await finished(server, job.id);
    expect(outcomes(done)['D-2']).toBe('skipped');
    expect(server.peek('D-2')!.stage).toBe('demo');
  });

  it('a retried start after a lost reply returns the same job (no second job)', async () => {
    const server = setup();
    server.injectFailure('lost');
    await expect(server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya)).rejects.toThrow();
    const again = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    expect((await server.bulkJobs('Priya')).map((j) => j.id)).toEqual([again.id]);
  });

  it('stop skips the deals not done yet', async () => {
    const server = setup({ latencyMinMs: 20, latencyMaxMs: 20 });
    const job = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    server.setConfig({ latencyMinMs: 0, latencyMaxMs: 0 }); // the stop request lands before the job's first batch
    await server.cancelBulk(job.id);
    const done = await finished(server, job.id);
    expect(done.cancelled).toBe(true);
    expect(Object.values(outcomes(done))).toEqual(['skipped', 'skipped', 'skipped']);
    expect(server.peek('D-0')!.stage).toBe('demo');
  });

  it('undo moves back only what the job moved and nobody changed since', async () => {
    const server = setup();
    const job = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    await finished(server, job.id);
    await server.move([{ id: 'D-1', expected: 'lost', target: 'won', key: 'r1' }], rahul); // Rahul changed one since
    const undo = await server.undoBulk(job.id, 'u1', priya);
    expect(outcomes(await finished(server, undo.id))).toEqual({ 'D-0': 'ok', 'D-1': 'skipped', 'D-2': 'ok' });
    expect(server.peek('D-0')!.stage).toBe('demo');
    expect(server.peek('D-1')!.stage).toBe('won');
  });

  it('refused deals can be retried within the same job', async () => {
    const server = setup({ itemFailureRate: 1 });
    const job = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    expect(Object.values(outcomes(await finished(server, job.id)))).toEqual(['failed', 'failed', 'failed']);
    server.setConfig({ itemFailureRate: 0 });
    await server.retryBulkFailed(job.id);
    expect(Object.values(outcomes(await finished(server, job.id)))).toEqual(['ok', 'ok', 'ok']);
  });

  it(`refuses a plain move of more than ${MAX_MOVE_ITEMS} deals`, async () => {
    const server = setup();
    const items = Array.from({ length: MAX_MOVE_ITEMS + 1 }, (_, i) => ({ id: `D-${i}`, expected: 'demo' as Stage, target: 'lost' as Stage, key: `k${i}` }));
    await expect(server.move(items, priya)).rejects.toThrow(/bulk job/);
  });
});

describe('announcing multi-deal changes (one message per action)', () => {
  const listen = (server: FakeServer) => {
    const pushes: string[] = [];
    const bulk: { by: string; ids: string[] }[] = [];
    server.onPush((d) => pushes.push(d.id));
    server.onBulkChange((c) => bulk.push({ by: c.by, ids: c.deals.map((d) => d.id) }));
    return { pushes, bulk };
  };
  const flush = () => new Promise((r) => setTimeout(r, 5));

  it('a hand-picked move of several deals is one message, not one push per deal', async () => {
    const server = setup();
    const heard = listen(server);
    await server.move(['D-0', 'D-1', 'D-2'].map((id) => ({ id, expected: 'demo' as Stage, target: 'lost' as Stage, key: `k-${id}` })), rahul);
    await flush();
    expect(heard.pushes).toEqual([]);
    expect(heard.bulk).toEqual([{ by: 'Rahul', ids: ['D-0', 'D-1', 'D-2'] }]);
  });

  it('a bulk job is announced once, when it finishes', async () => {
    const server = setup();
    const heard = listen(server);
    const job = await server.startBulkMove({ key: 'k1', label: 'x', filter: allMine, target: 'lost' }, priya);
    await finished(server, job.id);
    await flush();
    expect(heard.pushes).toEqual([]);
    expect(heard.bulk).toEqual([{ by: 'Priya', ids: ['D-0', 'D-1', 'D-2'] }]);
  });

  it("the simulator's teammate bulk move changes only that user's open deals, in one message", async () => {
    const server = setup();
    const heard = listen(server);
    server.teammateBulkMove('Priya', 2);
    await flush();
    expect(heard.bulk).toHaveLength(1);
    expect(heard.bulk[0].ids).toHaveLength(2);
    for (const id of heard.bulk[0].ids) expect(server.peek(id)!).toMatchObject({ owner: 'Priya', stage: 'lost' });
  });
});
