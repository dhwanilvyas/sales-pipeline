import { describe, expect, it } from 'vitest';
import { FakeServer } from '@mock-server/fakeServer';
import type { SimConfig } from '@mock-server/types';
import { mulberry32 } from '@mock-server/seed';
import type { Deal, Stage } from '@/entities/deal/deal.types';
import { PipelineClient, type Job, type OutboxStore, type StoredPending } from './pipelineClient';
import { DEFAULT_SORT, type Query } from '@/entities/deal/deal.query';

const NOW = new Date('2026-11-17T10:00:00').getTime();

function deal(i: number, stage: Stage = 'demo', owner = 'Priya'): Deal {
  return {
    id: `D-${i}`, name: `Deal ${i}`, licences: 10, value: 100_000, owner, stage,
    nextStepAt: null, expectedCloseAt: NOW, lastActivityAt: NOW, stageChangedAt: NOW, stageChangedBy: 'x',
    updatedAt: NOW, updatedBy: 'seed', updatedBySession: 'seed', version: 1, seq: 0,
  };
}

const QUIET: Partial<SimConfig> = {
  latencyMinMs: 0, latencyMaxMs: 0, failureRate: 0, itemFailureRate: 0,
  pushDelayMaxMs: 0, teammateEditsPerSec: 0,
};

async function setup(n = 5, config: Partial<SimConfig> = {}, clientOpts: { maxAutoRetries?: number; session?: string; me?: string; outbox?: OutboxStore } = {}) {
  const deals = Array.from({ length: n }, (_, i) => deal(i));
  const server = new FakeServer(deals, { config: { ...QUIET, ...config }, random: mulberry32(7) });
  const client = await connect(server, clientOpts);
  return { server, client };
}

async function connect(server: FakeServer, o: { maxAutoRetries?: number; session?: string; me?: string; outbox?: OutboxStore } = {}) {
  const client = new PipelineClient(server, {
    me: o.me ?? 'Priya', session: o.session ?? 'tab-1', backoffMs: 0, probeMs: 0, maxAutoRetries: o.maxAutoRetries ?? 3, outbox: o.outbox,
  });
  await client.load();
  return client;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function idle(...clients: PipelineClient[]) {
  for (let i = 0; i < 1000; i++) {
    await tick();
    if (clients.every((c) => c.isIdle())) {
      await tick();
      await tick(); // let zero-delay pushes land
      return;
    }
  }
  throw new Error('client never became idle');
}

describe('single moves', () => {
  it('saves a move and clears pending state', async () => {
    const { server, client } = await setup();
    client.move('D-0', 'proposal');
    expect(client.getView('D-0')!.deal.stage).toBe('proposal'); // optimistic
    expect(client.getView('D-0')!.status).toBe('queued');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(server.peek('D-0')!.version).toBe(2);
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('retries a dropped request automatically and applies it once', async () => {
    const { server, client } = await setup();
    server.injectFailure('drop');
    client.move('D-0', 'proposal');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(server.stats.applied).toBe(1);
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('never applies a save twice when the response was lost (idempotency key reused)', async () => {
    const { server, client } = await setup();
    server.injectFailure('lost');
    client.move('D-0', 'proposal');
    await idle(client);
    expect(server.peek('D-0')!.version).toBe(2);
    expect(server.stats.applied).toBe(1);
    expect(server.stats.duplicatesSuppressed).toBe(1);
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('surfaces a failure after auto-retries run out, and manual retry saves it', async () => {
    // 2 failures in a row: one save running out of retries (3 in a row would mean "server unreachable").
    const { server, client } = await setup(5, {}, { maxAutoRetries: 1 });
    server.injectFailure('drop', 2);
    client.move('D-0', 'proposal');
    await idle(client);
    const v = client.getView('D-0')!;
    expect(v.status).toBe('failed');
    expect(v.deal.stage).toBe('proposal'); // still shows what the user wanted
    expect(server.peek('D-0')!.stage).toBe('demo');
    client.retry('D-0');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('discarding a failed change whose response was lost reverts the server too', async () => {
    const { server, client } = await setup(5, {}, { maxAutoRetries: 0 });
    server.injectFailure('lost');
    client.move('D-0', 'proposal');
    await idle(client);
    expect(client.getView('D-0')!.status).toBe('failed');
    expect(server.peek('D-0')!.stage).toBe('proposal'); // it actually went through
    client.discard('D-0');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('demo');
    expect(client.getView('D-0')!.deal.stage).toBe('demo');
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('coalesces rapid moves of the same deal into at most two requests', async () => {
    const { server, client } = await setup();
    client.move('D-0', 'proposal');
    await Promise.resolve(); // first request goes out
    await Promise.resolve();
    client.move('D-0', 'negotiation');
    client.move('D-0', 'won');
    client.move('D-0', 'lost');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('lost');
    expect(server.stats.requests).toBeLessThanOrEqual(2);
    expect(server.stats.conflicts).toBe(0);
  });

  it('move + undo before the request is sent produces no write', async () => {
    const { server, client } = await setup();
    client.move('D-0', 'proposal');
    client.undo();
    await idle(client);
    expect(server.stats.applied).toBe(0);
    expect(client.getView('D-0')!.deal.stage).toBe('demo');
  });
});

const memoryOutbox = (): OutboxStore & { entries: StoredPending[] } => {
  const box = { entries: [] as StoredPending[], save: (e: StoredPending[]) => void (box.entries = e) };
  return box;
};

describe('offline and server down', () => {
  it('offline: new changes are refused (and the user is told); one made just before the drop waits and syncs', async () => {
    const { server, client } = await setup(5);
    let told = 0;
    client.onBlocked(() => told++);
    server.setConfig({ online: false }); // the connection drops while this save is on its way
    client.move('D-0', 'proposal');
    await idle(client);
    expect(client.getView('D-0')!.status).toBe('waiting'); // kept, not failed
    expect(client.summary()).toMatchObject({ waiting: 1, failed: 0 });
    expect(client.move('D-1', 'won')).toBe(false); // now that we know: new changes are paused
    expect(client.getView('D-1')!.deal.stage).toBe('demo');
    expect(client.moveMany([{ id: 'D-2', expected: 'demo', target: 'lost' }, { id: 'D-3', expected: 'demo', target: 'lost' }], 'bulk')).toBeNull();
    expect(told).toBe(2);
    server.setConfig({ online: true });
    client.setOnline(true);
    client.retryNow();
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(client.getView('D-0')!.status).toBeNull();
    expect(client.move('D-1', 'won')).toBe(true); // back online: editing works again
  });

  it('a request that hits "offline" mid-flight waits instead of failing', async () => {
    const { server, client } = await setup();
    server.setConfig({ online: false }); // client doesn't know yet
    client.move('D-0', 'proposal');
    await idle(client);
    expect(client.connection).toBe('offline');
    expect(client.getView('D-0')!.status).toBe('waiting');
    server.setConfig({ online: true });
    client.setOnline(true);
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
  });

  it('a change made just before the drop + a teammate edit meanwhile → conflict on sync, never overwritten', async () => {
    const { server, client } = await setup();
    server.setConfig({ online: false });
    client.move('D-0', 'lost'); // on its way when the connection dropped: waits
    await idle(client);
    server.teammateEdit('D-0', 'stage');
    const theirs = server.peek('D-0')!.stage;
    server.setConfig({ online: true });
    client.setOnline(true);
    client.retryNow();
    await idle(client);
    if (theirs === 'lost') return; // teammate did the same thing
    expect(client.getView('D-0')!.status).toBe('conflict');
    expect(server.peek('D-0')!.stage).toBe(theirs);
  });

  it('catches up on changes missed while offline (pushes stop when offline)', async () => {
    const { server, client } = await setup();
    server.setConfig({ online: false });
    client.setOnline(false);
    server.teammateEdit('D-1', 'value');
    await idle(client);
    expect(client.getView('D-1')!.deal.value).toBe(100_000); // missed it
    server.setConfig({ online: true });
    client.setOnline(true);
    await idle(client);
    expect(client.getView('D-1')!.deal.value).toBe(server.peek('D-1')!.value);
  });

  it('server down: after 3 failed requests it pauses (changes wait), then recovers by itself', async () => {
    const { server, client } = await setup(5, { failureRate: 1, lostResponseShare: 0 }, { maxAutoRetries: 5 });
    client.move('D-0', 'proposal');
    for (let i = 0; i < 200 && client.connection !== 'unreachable'; i++) await tick();
    expect(client.connection).toBe('unreachable');
    expect(client.getView('D-0')!.status).toBe('waiting');
    expect(client.summary().failed).toBe(0);
    server.setConfig({ failureRate: 0 });
    client.retryNow();
    await idle(client);
    expect(client.connection).toBe('online');
    expect(server.peek('D-0')!.stage).toBe('proposal');
  });

  it('a bulk job remembers where each deal came from and what happened to it (job details panel)', async () => {
    const { client } = await setup(5);
    const job = client.moveMany([{ id: 'D-1', expected: 'demo', target: 'lost' }, { id: 'D-2', expected: 'demo', target: 'lost' }], 'bulk')!;
    expect(job.from.get('D-1')).toBe('demo');
    await idle(client);
    expect(job.outcomes.get('D-1')).toBe('ok');
    expect(job.outcomes.get('D-2')).toBe('ok');
  });

  it('changes left over from a closed tab: drops what is done, flags what changed since, continues safely', async () => {
    const { server, client: priya } = await setup(5);
    const rahul = await connect(server, { me: 'Rahul', session: 'tab-r' });
    rahul.move('D-2', 'won'); // Rahul already made the change Priya wanted
    rahul.move('D-3', 'negotiation'); // Rahul moved the deal Priya wanted in Proposal
    await idle(rahul, priya);
    const leftover: StoredPending[] = [
      { id: 'D-1', origin: 'demo', desired: 'lost', req: null, status: 'queued' },
      { id: 'D-2', origin: 'demo', desired: 'won', req: null, status: 'queued' },
      { id: 'D-3', origin: 'demo', desired: 'proposal', req: null, status: 'queued' },
      { id: 'D-404', origin: 'demo', desired: 'lost', req: null, status: 'queued' },
    ];
    const check = priya.checkLeftovers(leftover);
    expect(check.entries.map((e) => e.id)).toEqual(['D-1', 'D-3']);
    expect(check.changedSince).toBe(1);

    expect(priya.continueLeftovers(leftover)).toBe(2);
    expect(priya.getJobs()[0].label).toBe('Finishing 2 unsaved changes');
    await idle(priya);
    expect(server.peek('D-1')!.stage).toBe('lost');
    expect(server.peek('D-3')!.stage).toBe('negotiation'); // Rahul's move is not overwritten
    expect(priya.getView('D-3')!.status).toBe('conflict');
  });


  it('unsaved changes survive a reload, wait for the user, and are applied once, even if the first send went through', async () => {
    const outbox = memoryOutbox();
    const { server, client } = await setup(5, {}, { outbox, maxAutoRetries: 0 });
    server.injectFailure('lost'); // applied on the server, but the tab never heard back
    client.move('D-0', 'proposal');
    await idle(client);
    server.setConfig({ online: false }); // the connection drops as D-1's save goes out
    client.move('D-1', 'won'); // never reaches the server: waits
    await idle(client);
    client.flushOutbox();
    expect(outbox.entries.map((e) => e.id).sort()).toEqual(['D-0', 'D-1']);
    client.destroy();

    server.setConfig({ online: true });
    const sent = server.stats.requests;
    const reloaded = await connect(server, { session: 'tab-2', outbox });
    expect(server.stats.requests).toBe(sent); // nothing re-sent on its own: the app asks first
    // D-0 reached the server before the reply was lost: already done, so it isn't offered again.
    expect(reloaded.checkLeftovers(outbox.entries).entries.map((e) => e.id)).toEqual(['D-1']);
    expect(reloaded.continueLeftovers(outbox.entries)).toBe(1);
    await idle(reloaded);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(server.peek('D-0')!.version).toBe(2); // not applied twice
    expect(server.peek('D-1')!.stage).toBe('won');
    reloaded.flushOutbox();
    expect(outbox.entries).toEqual([]);
  });
});

describe("others' changes reach me as one entry per action", () => {
  it("Rahul moving 3 of my deals together: patched, one entry for the toast, all waiting for Apply", async () => {
    const { server, client: priya } = await setup(5);
    const rahul = await connect(server, { me: 'Rahul', session: 'tab-r' });
    rahul.moveMany(['D-0', 'D-1', 'D-2'].map((id) => ({ id, expected: 'demo' as Stage, target: 'lost' as Stage })), 'cleanup');
    await idle(rahul, priya);
    expect(priya.getView('D-1')!.deal).toMatchObject({ stage: 'lost', version: 2, stageChangedBy: 'Rahul' });
    expect(priya.recentActivity()).toHaveLength(1);
    expect(priya.recentActivity()[0]).toMatchObject({ by: 'Rahul', what: 'moved to Lost', count: 3, forMe: 3 });
    expect(priya.recentActivity()[0].deals[0]).toMatchObject({ from: 'demo', to: 'lost', fromOwner: 'Priya', toOwner: 'Priya' }); // for "View"
    expect(priya.externalChangeCount()).toBe(3); // the pill: the board waits for Apply
  });

  it('a skipped version in a bulk message is fetched, not guessed', async () => {
    const { server, client: priya } = await setup(5);
    server.teammateEdit('D-0', 'value'); // v2, as if Priya never got this push
    await idle(priya);
    const seen = priya.getView('D-0')!.deal.version;
    // a bulk message saying D-0 is now two versions ahead
    (priya as unknown as { applyBulkChange(c: unknown): void }).applyBulkChange({
      by: 'Riya', session: 'tab-x', at: NOW, deals: [{ id: 'D-0', stage: 'lost', version: seen + 2, seq: 99 }],
    });
    expect(priya.getView('D-0')!.deal.version).toBe(seen); // not patched blindly
  });

  it('changes missed while offline arrive on reconnect, marked as missed, grouped by who did what', async () => {
    const { server, client: priya } = await setup(5);
    priya.setOnline(false);
    server.setConfig({ online: false }); // no pushes reach anyone now
    server.teammateEdit('D-0', 'stage'); // a teammate keeps working meanwhile
    server.teammateEdit('D-1', 'stage');
    await idle(priya);
    expect(priya.recentActivity()).toEqual([]); // nothing heard yet
    server.setConfig({ online: true });
    priya.setOnline(true);
    for (let i = 0; i < 50 && !priya.recentActivity().length; i++) await tick();
    const missed = priya.recentActivity();
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.every((a) => a.offline && a.forMe > 0)).toBe(true);
    expect(missed.reduce((n, a) => n + a.count, 0)).toBe(2);
    expect(priya.externalChangeCount()).toBe(2); // waiting for Apply
  });
});

describe('conflicts', () => {
  it('detects a teammate change to the same field and never overwrites it', async () => {
    const { server, client } = await setup(5, { conflictNextSave: true });
    client.move('D-0', 'proposal');
    await idle(client);
    const v = client.getView('D-0')!;
    expect(v.status).toBe('conflict');
    expect(v.theirs!.self).toBe(false);
    const theirs = server.peek('D-0')!.stage;
    expect(theirs).not.toBe('proposal');
    expect(theirs).not.toBe('demo');

    client.keepTheirs('D-0');
    expect(client.getView('D-0')!.deal.stage).toBe(theirs);
    expect(server.stats.applied).toBe(0);
  });

  it('"apply mine" re-sends against the teammate\'s version', async () => {
    const { server, client } = await setup(5, { conflictNextSave: true });
    client.move('D-0', 'proposal');
    await idle(client);
    client.applyMine('D-0');
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(client.getView('D-0')!.status).toBeNull();
  });

  it('does not conflict when a teammate changed a different field', async () => {
    const { server, client } = await setup();
    server.teammateEdit('D-0', 'value');
    const newValue = server.peek('D-0')!.value;
    client.move('D-0', 'proposal'); // client may not even have seen the push yet
    await idle(client);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(server.peek('D-0')!.value).toBe(newValue);
    expect(client.getView('D-0')!.deal.value).toBe(newValue);
  });

  it('ignores pushes older than what it already has', async () => {
    const { server, client } = await setup();
    client.move('D-0', 'proposal');
    await idle(client);
    const current = client.getView('D-0')!.deal;
    // Simulate a late, stale push arriving after the newer save response.
    (client as unknown as { applyServer(d: Deal): void }).applyServer({ ...current, stage: 'new', version: 1 });
    expect(client.getView('D-0')!.deal.stage).toBe('proposal');
    expect(server.peek('D-0')!.stage).toBe('proposal');
  });

  it('two tabs of the same user: second save conflicts and is labelled as "you"', async () => {
    const { server, client: tab1 } = await setup();
    const tab2 = await connect(server, { session: 'tab-2' });
    tab1.move('D-0', 'proposal');
    tab2.move('D-0', 'lost');
    await idle(tab1, tab2);
    const statuses = [tab1.getView('D-0')!.status, tab2.getView('D-0')!.status];
    expect(statuses).toContain('conflict');
    const loser = tab1.getView('D-0')!.status === 'conflict' ? tab1 : tab2;
    expect(loser.getView('D-0')!.theirs!.self).toBe(true);
    // The winning tab's change reaches the other tab and counts as external there.
    expect(loser.externalChangeCount()).toBe(1);
    expect(server.stats.applied).toBe(1);
  });
});

describe('two people bulk-moving the same deals at once', () => {
  it('each deal conflicts for at most one of them (whoever landed second), even with a flaky network', async () => {
    const N = 200;
    const server = new FakeServer(Array.from({ length: N }, (_, i) => deal(i, 'new')), {
      config: { latencyMinMs: 1, latencyMaxMs: 10, failureRate: 0.1, lostResponseShare: 0.3, itemFailureRate: 0, pushDelayMaxMs: 5, teammateEditsPerSec: 0 },
      random: mulberry32(1),
    });
    const ananya = await connect(server, { me: 'Ananya', session: 'ananya' });
    const priya = await connect(server, { me: 'Priya', session: 'priya' });
    const ids = Array.from({ length: N }, (_, i) => `D-${i}`);
    ananya.moveMany(ids.map((id) => ({ id, expected: 'new' as Stage, target: 'demo' as Stage })), 'A');
    priya.moveMany(ids.map((id) => ({ id, expected: 'new' as Stage, target: 'lost' as Stage })), 'P');
    for (let i = 0; i < 400 && !(ananya.isIdle() && priya.isIdle()); i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20)); // late pushes
    const inConflict = (c: PipelineClient) => ids.filter((id) => c.getView(id)!.status === 'conflict');
    const a = inConflict(ananya), p = inConflict(priya);
    expect(a.length + p.length).toBe(N); // every deal: one of them won, the other got a conflict
    expect(a.filter((id) => p.includes(id))).toEqual([]); // never both on the same deal
  });
});

describe('keep theirs', () => {
  it('accepting their change marks the deal as seen: shown where it is, nothing left to apply', async () => {
    const { server, client } = await setup(3);
    server.setConfig({ conflictNextSave: true });
    client.move('D-0', 'proposal');
    await idle(client);
    expect(client.getView('D-0')!.status).toBe('conflict');
    client.keepTheirs('D-0');
    expect(client.getView('D-0')!.accepted).toBe(true);
    expect(client.hasExternalChange('D-0')).toBe(false);
    server.teammateEdit('D-0', 'stage'); // they change it again: a normal teammate change once more
    await idle(client);
    expect(client.getView('D-0')!.accepted).toBe(false);
  });
});

describe('conflict groups', () => {
  /** Priya bulk-moves D-0..D-9 (selected as "demo") to Proposal after Rahul and Kavya moved some of them. */
  async function scenario() {
    const { server, client: priya } = await setup(10);
    const rahul = await connect(server, { me: 'Rahul', session: 'rahul' });
    const kavya = await connect(server, { me: 'Kavya', session: 'kavya' });
    for (let i = 0; i < 6; i++) rahul.move(`D-${i}`, 'lost');
    kavya.move('D-6', 'won');
    kavya.move('D-7', 'won');
    await idle(rahul, kavya);
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `D-${i}`, expected: 'demo' as Stage, target: 'proposal' as Stage }));
    const job = priya.moveMany(entries, 'bulk')!;
    await idle(priya, rahul, kavya);
    return { server, priya, rahul, kavya, job };
  }

  it('groups conflicts by who moved the deals and where, biggest first', async () => {
    const { priya, job } = await scenario();
    expect(job.counts).toMatchObject({ ok: 2, conflict: 8 });
    const groups = priya.conflictGroups();
    expect(groups.map((g) => [g.by, g.stage, g.ids.length])).toEqual([['Rahul', 'lost', 6], ['Kavya', 'won', 2]]);
    expect(groups[0].wanted).toEqual({ proposal: 6 });
  });

  it('resolves a whole group at once: keep theirs for one, apply mine for another', async () => {
    const { server, priya } = await scenario();
    const [rahulGroup, kavyaGroup] = priya.conflictGroups();
    expect(priya.resolveConflicts(rahulGroup.ids, 'theirs')).toBe(6);
    expect(priya.resolveConflicts(kavyaGroup.ids, 'mine')).toBe(2);
    await idle(priya);
    for (let i = 0; i < 6; i++) expect(server.peek(`D-${i}`)!.stage).toBe('lost');
    expect(server.peek('D-6')!.stage).toBe('proposal');
    expect(server.peek('D-7')!.stage).toBe('proposal');
    expect(priya.conflictGroups()).toEqual([]);
    expect(priya.summary().conflicts).toBe(0);
  });

  it('credits the person who changed the STAGE, not whoever touched the deal last', async () => {
    const { server, client: priya } = await setup(1);
    const rahul = await connect(server, { me: 'Rahul', session: 'rahul' });
    rahul.move('D-0', 'lost');
    await idle(rahul);
    server.teammateEdit('D-0', 'value'); // someone else edits the value afterwards
    expect(server.peek('D-0')!.updatedBy).not.toBe('Rahul');
    priya.moveMany([{ id: 'D-0', expected: 'demo', target: 'proposal' }], 'selected before Rahul moved it');
    await idle(priya);
    expect(priya.getView('D-0')!.theirs).toMatchObject({ by: 'Rahul', stage: 'lost' });
  });

  it('a conflict clears itself when someone moves the deal to what I wanted', async () => {
    const { server, priya, rahul } = await scenario();
    rahul.move('D-0', 'proposal');
    await idle(priya, rahul);
    expect(server.peek('D-0')!.stage).toBe('proposal');
    expect(priya.getView('D-0')!.status).toBeNull();
    expect(priya.conflictGroups()[0].ids).toHaveLength(5);
  });
});

describe('bulk moves', () => {
  it('reports exact per-deal outcomes with partial failures, and retry finishes the job', async () => {
    const { server, client } = await setup(1000, { itemFailureRate: 0.1 }, { maxAutoRetries: 0 });
    const entries = Array.from({ length: 1000 }, (_, i) => ({ id: `D-${i}`, expected: 'demo' as Stage, target: 'lost' as Stage }));
    const job = client.moveMany(entries, 'Quarter-end cleanup')!;
    await idle(client);
    const c = job.counts;
    expect(c.ok + c.failed + c.conflict + c.skipped).toBe(1000);
    expect(c.failed).toBeGreaterThan(0);
    expect(c.ok).toBeGreaterThan(800);
    expect(server.stats.requests).toBe(1); // hand-picked (up to 1,000): one request
    for (const [id, o] of job.outcomes) {
      expect(server.peek(id)!.stage).toBe(o === 'ok' ? 'lost' : 'demo');
    }
    server.setConfig({ itemFailureRate: 0 });
    client.retryAll();
    await idle(client);
    expect(job.counts.ok).toBe(1000);
    expect(job.counts.failed).toBe(0);
  });

  it('a deal changed after it was selected comes back as a conflict, not overwritten', async () => {
    const { server, client } = await setup(10);
    server.teammateEdit('D-3', 'stage'); // after the user selected it as "demo"
    const won = server.peek('D-3')!.stage;
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `D-${i}`, expected: 'demo' as Stage, target: 'lost' as Stage }));
    const job = client.moveMany(entries, 'bulk')!;
    await idle(client);
    if (won === 'lost') {
      expect(job.counts.ok).toBe(10); // teammate already did it: silent success
    } else {
      expect(job.counts.ok).toBe(9);
      expect(job.counts.conflict).toBe(1);
      expect(server.peek('D-3')!.stage).toBe(won);
    }
  });

  it('undo reverts the bulk move but leaves deals a teammate changed since', async () => {
    const { server, client } = await setup(10);
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `D-${i}`, expected: 'demo' as Stage, target: 'lost' as Stage }));
    client.moveMany(entries, 'bulk');
    await idle(client);
    server.teammateEdit('D-5', 'stage');
    const theirs = server.peek('D-5')!.stage;
    await idle(client);
    const r = client.undo()!;
    await idle(client);
    for (let i = 0; i < 10; i++) {
      expect(server.peek(`D-${i}`)!.stage).toBe(i === 5 ? theirs : 'demo');
    }
    expect(r.reverted + r.skipped).toBe(10);
  });

});

describe('select all: a job the server runs', () => {
  const allMine: Query = { view: 'open', scope: 'mine', me: 'Priya', stage: null, search: '', sort: DEFAULT_SORT.open };
  const shown = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `D-${from + i}`, expected: 'demo' as Stage, target: 'lost' as Stage }));
  const started = async (job: Job) => { for (let i = 0; i < 200 && !job.server?.id; i++) await tick(); };

  it('sends one filter request (no IDs); cards move at once and settle with the server results', async () => {
    const { server, client } = await setup(20);
    const job = client.moveMatching(allMine, 'lost', shown(20), 'All mine → Lost')!;
    expect(client.getView('D-7')!.deal.stage).toBe('lost');
    expect(client.getView('D-7')!.status).toBe('saving');
    await idle(client);
    expect(server.stats.requests).toBe(0); // no move() requests: the server did the work
    expect(job.counts.ok).toBe(20);
    expect(client.getView('D-7')!.status).toBeNull();
    expect(server.peek('D-7')!.stage).toBe('lost');
  });

  it('a deal moved by hand during the job keeps the hand move (the job skips it)', async () => {
    const { server, client } = await setup(300, { latencyMinMs: 5, latencyMaxMs: 5 });
    const job = client.moveMatching(allMine, 'lost', shown(300), 'x')!;
    client.move('D-299', 'won'); // in the job's last batch
    await idle(client);
    expect(server.peek('D-299')!.stage).toBe('won');
    expect(job.outcomes.get('D-299')).toBe('skipped');
    expect(job.counts.ok).toBe(299);
  });

  it('Stop skips the deals not done yet and puts their cards back', async () => {
    const { server, client } = await setup(1000, { latencyMinMs: 5, latencyMaxMs: 5 });
    const job = client.moveMatching(allMine, 'lost', shown(1000), 'x')!;
    await started(job);
    client.cancelJob(job.id);
    await idle(client);
    expect(job.counts.skipped).toBeGreaterThan(0);
    expect(job.counts.ok + job.counts.skipped).toBe(1000);
    const skipped = [...job.outcomes].find(([, o]) => o === 'skipped')![0];
    expect(client.getView(skipped)!.deal.stage).toBe('demo');
    expect(server.peek(skipped)!.stage).toBe('demo');
    expect(client.summary().saving).toBe(0);
  });

  it('undo is done by the server and leaves deals changed since', async () => {
    const { server, client } = await setup(10);
    client.moveMatching(allMine, 'lost', shown(10), 'x');
    await idle(client);
    server.teammateEdit('D-5', 'stage');
    const theirs = server.peek('D-5')!.stage;
    await idle(client);
    const r = client.undo()!;
    await idle(client);
    for (let i = 0; i < 10; i++) expect(server.peek(`D-${i}`)!.stage).toBe(i === 5 ? theirs : 'demo');
    expect(r.reverted + r.skipped).toBe(10);
  });

  it('refused deals show Not saved; "Retry failed" has the server retry them in the same job', async () => {
    const { server, client } = await setup(50, { itemFailureRate: 0.3 });
    const job = client.moveMatching(allMine, 'lost', shown(50), 'x')!;
    await idle(client);
    const failed = [...job.outcomes].filter(([, o]) => o === 'failed').map(([id]) => id);
    expect(failed.length).toBeGreaterThan(0);
    expect(client.getView(failed[0])!.status).toBe('failed');
    server.setConfig({ itemFailureRate: 0 });
    client.retryJobFailed(job.id);
    await idle(client);
    expect(job.counts.ok).toBe(50);
    expect(server.peek(failed[0])!.stage).toBe('lost');
  });

  it('closing a job keeps it under recent jobs; it can be reopened; Shift+S stops the running one', async () => {
    const { client } = await setup(1000, { latencyMinMs: 5, latencyMaxMs: 5 });
    const job = client.moveMatching(allMine, 'lost', shown(1000), 'x')!;
    await started(job);
    expect(client.stopRunningJob()).toBe(job);
    await idle(client);
    expect(client.stopRunningJob()).toBeNull(); // nothing running any more
    client.dismissJob(job.id);
    expect(client.getJobs()).toEqual([]);
    expect(client.recentJobs()).toEqual([job]);
    client.reopenJob(job.id);
    expect(client.getJobs()).toEqual([job]);
  });

  it('after a reload a running job shows up again and finishes on screen', async () => {
    const { server, client } = await setup(1000, { latencyMinMs: 5, latencyMaxMs: 5 });
    const job = client.moveMatching(allMine, 'lost', shown(1000), 'All mine → Lost')!;
    await started(job);
    client.destroy(); // tab reloaded mid-job: the server keeps going
    const reloaded = await connect(server, { session: 'tab-2' });
    for (let i = 0; i < 100 && !reloaded.getJobs().length; i++) await tick();
    expect(reloaded.getJobs()[0].label).toBe('All mine → Lost');
    await idle(reloaded);
    expect(reloaded.getJobs()[0].counts.ok).toBe(1000);
    expect(server.peek('D-999')!.stage).toBe('lost');
  });
});
