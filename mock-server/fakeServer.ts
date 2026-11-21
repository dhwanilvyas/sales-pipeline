import { DEFAULT_CONFIG, type ServerStats, type SimConfig } from './types';
import {
  DAY, MAX_MOVE_ITEMS, NetworkError, OWNERS, STAGES, isOpen, matches,
  type Actor, type BulkChange, type BulkJob, type BulkResult, type BulkUpdate, type Deal, type ItemResult, type MoveItem, type Query, type Stage,
} from '@/entities/deal';

export type ForcedFailure = 'drop' | 'lost';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const SIM_SESSION = 'sim';
/** Finished jobs are kept this long, so a tab that comes back still sees how they ended. */
const KEEP_JOBS_MS = 30 * 60_000;

/** A bulk job as the server keeps it. */
interface Job extends BulkJob {
  key: string;
  actor: Actor;
  /** Each deal's version when the job started: a deal changed since (by anyone) is skipped, never overwritten. */
  versions: Map<string, number>;
  queue: string[];
  done: Map<string, BulkResult>;
  /** Deals this job changed and hasn't announced yet (sent as one BulkChange when it finishes). */
  written: BulkChange['deals'];
}

/**
 * In-memory stand-in for the backend. It owns the source of truth, applies
 * writes with a compare-and-set on the field being changed, remembers
 * idempotency keys, and pushes every change to subscribers after a random
 * delay (so pushes can arrive out of order, like a real socket fan-out).
 *
 * In the app it runs inside a SharedWorker so every tab talks to the same
 * instance; tests use it directly.
 */
export class FakeServer {
  private db = new Map<string, Deal>();
  private ids: string[];
  private byOwner = new Map<string, string[]>();
  private idem = new Map<string, ItemResult>();
  private pushListeners = new Set<(deal: Deal) => void>();
  private configListeners = new Set<(c: SimConfig) => void>();
  private writeListeners = new Set<(deal: Deal) => void>();
  private forced: ForcedFailure[] = [];
  private jobs = new Map<string, Job>();
  private jobByKey = new Map<string, string>();
  private jobListeners = new Set<(u: BulkUpdate) => void>();
  private bulkChangeListeners = new Set<(c: BulkChange) => void>();
  private teammateTimer: ReturnType<typeof setInterval> | null = null;
  private carry = 0;
  private sessions = new Map<string, string>(); // session -> user
  private config: SimConfig;
  /** Server-wide change counter (each write gets the next number). */
  private seq = 0;
  private random: () => number;
  private now: () => number;

  readonly stats: ServerStats = { requests: 0, applied: 0, duplicatesSuppressed: 0, conflicts: 0, failedRequests: 0 };

  constructor(deals: Deal[], opts: { config?: Partial<SimConfig>; random?: () => number; now?: () => number; seq?: number } = {}) {
    for (const d of deals) {
      this.db.set(d.id, d);
      this.indexOwner(d);
    }
    this.ids = deals.map((d) => d.id);
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.random = opts.random ?? Math.random;
    this.now = opts.now ?? Date.now;
    this.seq = opts.seq ?? 0;
  }

  private indexOwner(d: Deal) {
    const list = this.byOwner.get(d.owner);
    if (list) list.push(d.id);
    else this.byOwner.set(d.owner, [d.id]);
  }

  // ---- configuration -------------------------------------------------------

  getConfig(): SimConfig {
    return this.config;
  }

  setConfig(patch: Partial<SimConfig>) {
    this.config = { ...this.config, ...patch };
    this.configListeners.forEach((l) => l(this.config));
  }

  onConfig(l: (c: SimConfig) => void) {
    this.configListeners.add(l);
    return () => void this.configListeners.delete(l);
  }

  /** People with the app open: never impersonated by the background teammates, and their deals are left alone. */
  registerSession(actor: Actor) {
    this.sessions.set(actor.session, actor.user);
  }

  unregisterSession(session: string) {
    this.sessions.delete(session);
  }

  private activeUsers(): Set<string> {
    return new Set(this.sessions.values());
  }

  /** Test/demo hook: force the outcome of the next request(s). */
  injectFailure(kind: ForcedFailure, times = 1) {
    for (let i = 0; i < times; i++) this.forced.push(kind);
  }

  // ---- API -----------------------------------------------------------------

  /** Every applied write (for persistence). Unlike pushes, this fires while "offline" too. */
  onWrite(l: (deal: Deal) => void) {
    this.writeListeners.add(l);
    return () => void this.writeListeners.delete(l);
  }

  onPush(l: (deal: Deal) => void) {
    this.pushListeners.add(l);
    return () => void this.pushListeners.delete(l);
  }

  onBulkChange(l: (c: BulkChange) => void) {
    this.bulkChangeListeners.add(l);
    return () => void this.bulkChangeListeners.delete(l);
  }

  async listDeals(): Promise<Deal[]> {
    await sleep(this.latency());
    return Array.from(this.db.values());
  }

  /** Catch-up after a disconnect: every deal written after `seq`. */
  async changesSince(seq: number): Promise<Deal[]> {
    if (!this.config.online) throw new NetworkError('You are offline', true);
    await sleep(this.latency());
    const out: Deal[] = [];
    for (const d of this.db.values()) if (d.seq > seq) out.push(d);
    return out;
  }

  /** Server-side read for tests. Not used by the client. */
  peek(id: string): Deal | undefined {
    return this.db.get(id);
  }

  /**
   * Move one or many deals. Each item succeeds or fails independently and the
   * response reports every item, so partial success is explicit.
   * Throws NetworkError when the request as a whole fails (possibly after applying!).
   */
  async move(items: MoveItem[], actor: Actor): Promise<ItemResult[]> {
    if (items.length > MAX_MOVE_ITEMS) throw new Error(`At most ${MAX_MOVE_ITEMS} deals per request; use a bulk job`);
    this.stats.requests++;
    if (!this.config.online) {
      await sleep(Math.min(80, this.config.latencyMinMs));
      this.stats.failedRequests++;
      throw new NetworkError('You are offline', true);
    }
    await sleep(this.latency());
    if (!this.config.online) {
      this.stats.failedRequests++;
      throw new NetworkError('Connection lost', true);
    }

    let failure: ForcedFailure | null = this.forced.shift() ?? null;
    if (!failure && this.random() < this.config.failureRate) {
      failure = this.random() < this.config.lostResponseShare ? 'lost' : 'drop';
    }
    if (failure === 'drop') {
      this.stats.failedRequests++;
      throw new NetworkError('Save failed: server unreachable');
    }

    if (this.config.conflictNextSave && items.length > 0) {
      this.setConfig({ conflictNextSave: false });
      const first = this.db.get(items[0].id);
      if (first) {
        const other = STAGES.find((s) => s !== items[0].expected && s !== items[0].target)!;
        this.write({ ...first, stage: other, stageChangedAt: this.now() }, { user: this.pickTeammate(), session: SIM_SESSION });
      }
    }

    // Several deals in one request are one action: announced once, not one push per deal.
    const written: BulkChange['deals'] | undefined = items.length > 1 ? [] : undefined;
    const results = items.map((item) => this.applyItem(item, actor, written));
    if (written?.length) this.announce(actor, written);
    if (failure === 'lost') {
      this.stats.failedRequests++;
      throw new NetworkError('Save timed out (it may have gone through)');
    }
    return results;
  }

  // ---- bulk jobs -----------------------------------------------------------
  // The server finds the deals matching the filter when the job starts and works through them in the
  // background, so the browser never sends thousands of IDs and closing the tab doesn't stop the job.
  // A deal anyone changes after the job started is skipped, so the job never overwrites newer work.

  async startBulkMove(req: { key: string; label: string; filter: Query; target: Stage }, actor: Actor): Promise<BulkJob> {
    return this.request(false, () => {
      const existing = this.jobByKey.get(req.key);
      if (existing) return this.snapshot(this.jobs.get(existing)!); // a retry after a lost reply: same job
      const now = this.now();
      const deals: BulkJob['deals'] = [];
      for (const d of this.db.values()) {
        if (d.stage !== req.target && matches(d, req.filter, now)) deals.push({ id: d.id, from: d.stage, to: req.target });
      }
      return this.snapshot(this.createJob(req.key, req.label, actor, deals));
    });
  }

  async cancelBulk(jobId: string): Promise<void> {
    return this.request(false, () => {
      const job = this.jobs.get(jobId);
      if (job && !job.finished) this.cancelNow(job);
    });
  }

  async retryBulkFailed(jobId: string): Promise<BulkJob> {
    return this.request(false, () => {
      const job = this.jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      const failed = [...job.done.values()].filter((r) => r.outcome === 'failed').map((r) => r.id);
      for (const id of failed) job.done.delete(id);
      job.queue.push(...failed);
      if (failed.length && job.finished) { job.finished = false; this.run(job); }
      return this.snapshot(job);
    });
  }

  async undoBulk(jobId: string, key: string, actor: Actor): Promise<BulkJob> {
    return this.request(false, () => {
      const existing = this.jobByKey.get(key);
      if (existing) return this.snapshot(this.jobs.get(existing)!);
      const job = this.jobs.get(jobId);
      if (!job) throw new Error('Job not found');
      if (!job.finished) this.cancelNow(job);
      const moved = job.deals.filter((d) => job.done.get(d.id)?.outcome === 'ok');
      const back = moved.map((d) => ({ id: d.id, from: d.to, to: d.from }));
      const undo = this.createJob(key, `Undo: ${job.label}`, actor, back);
      // Only deals still where the job left them are moved back; the rest were changed since.
      const changed = new Set(back.filter((d) => this.db.get(d.id)?.stage !== d.from).map((d) => d.id));
      undo.queue = undo.queue.filter((id) => !changed.has(id));
      this.record(undo, [...changed].map((id): BulkResult => ({ id, outcome: 'skipped', reason: 'Changed since' })));
      return this.snapshot(undo);
    });
  }

  async bulkJobs(user: string): Promise<BulkJob[]> {
    return this.request(true, () => {
      const cutoff = this.now() - KEEP_JOBS_MS;
      for (const [id, j] of this.jobs) if (j.finished && j.createdAt < cutoff) this.jobs.delete(id);
      return [...this.jobs.values()].filter((j) => j.user === user).map((j) => this.snapshot(j));
    });
  }

  onBulkUpdate(l: (u: BulkUpdate) => void) {
    this.jobListeners.add(l);
    return () => void this.jobListeners.delete(l);
  }

  private createJob(key: string, label: string, actor: Actor, deals: BulkJob['deals']): Job {
    const versions = new Map(deals.map((d) => [d.id, this.db.get(d.id)!.version] as const));
    const job: Job = {
      id: `job-${this.jobs.size + 1}-${Math.floor(this.random() * 1e6)}`, key, label, user: actor.user, actor, versions,
      deals, results: [], done: new Map(), written: [], queue: deals.map((d) => d.id), cancelled: false, finished: false, createdAt: this.now(),
    };
    this.jobs.set(job.id, job);
    this.jobByKey.set(key, job.id);
    this.run(job);
    return job;
  }

  /** Works through the job in batches (about 40 of them, so progress is visible), one batch per "latency". */
  private run(job: Job) {
    const batch = Math.max(100, Math.ceil(job.deals.length / 40));
    const step = () => {
      if (job.finished) return;
      if (!job.queue.length) return this.record(job, []);
      const to = new Map(job.deals.map((d) => [d.id, d.to] as const));
      const results = job.queue.splice(0, batch).map((id) => this.applyJobItem(job, id, to.get(id)!));
      this.record(job, results);
      if (!job.finished) setTimeout(step, this.latency());
    };
    setTimeout(step, this.latency());
  }

  private applyJobItem(job: Job, id: string, to: Stage): BulkResult {
    const deal = this.db.get(id);
    if (!deal) return { id, outcome: 'skipped', reason: 'Deal no longer exists' };
    if (deal.version !== job.versions.get(id)) return { id, outcome: 'skipped', reason: 'Changed by someone after the job started' };
    if (deal.stage === to) return { id, outcome: 'ok', deal };
    if (this.random() < this.config.itemFailureRate) return { id, outcome: 'failed', reason: 'Deal is locked by another process' };
    const now = this.now();
    this.stats.applied++;
    const next = this.write({ ...deal, stage: to, stageChangedAt: now, lastActivityAt: now }, job.actor, true);
    job.written.push({ id, stage: next.stage, version: next.version, seq: next.seq });
    return { id, outcome: 'ok', deal: next };
  }

  private cancelNow(job: Job) {
    job.cancelled = true;
    this.record(job, job.queue.splice(0).map((id): BulkResult => ({ id, outcome: 'skipped', reason: 'Stopped' })));
  }

  private record(job: Job, results: BulkResult[]) {
    for (const r of results) job.done.set(r.id, r);
    job.finished = !job.queue.length;
    // Everyone else hears about a job once, when it's done ("Riya moved 1,000 deals to Lost").
    if (job.finished && job.written.length) this.announce(job.actor, job.written.splice(0));
    // Like deal pushes, live progress only reaches online clients; others ask with bulkJobs() later.
    if (!this.config.online) return;
    const u: BulkUpdate = { jobId: job.id, results, cancelled: job.cancelled, finished: job.finished };
    for (const l of this.jobListeners) setTimeout(() => l(u), 0);
  }

  private snapshot(job: Job): BulkJob {
    const { id, label, user, deals, cancelled, finished, createdAt } = job;
    return { id, label, user, deals, results: [...job.done.values()], cancelled, finished, createdAt };
  }

  /**
   * A small request (not a bulk save): same network behaviour as a save (latency, offline, dropped or
   * lost replies). Reads leave `injectFailure` alone: it's meant for the next write.
   */
  private async request<T>(read: boolean, fn: () => T): Promise<T> {
    if (!this.config.online) throw new NetworkError('You are offline', true);
    await sleep(this.latency());
    if (!this.config.online) throw new NetworkError('Connection lost', true);
    let failure: ForcedFailure | null = read ? null : this.forced.shift() ?? null;
    if (!failure && this.random() < this.config.failureRate) failure = this.random() < this.config.lostResponseShare ? 'lost' : 'drop';
    if (failure === 'drop') throw new NetworkError('Request failed: server unreachable');
    const value = fn();
    if (failure === 'lost') throw new NetworkError('Request timed out (it may have gone through)');
    return value;
  }

  private applyItem(item: MoveItem, actor: Actor, written?: BulkChange['deals']): ItemResult {
    const cached = this.idem.get(item.key);
    if (cached) {
      this.stats.duplicatesSuppressed++;
      return cached;
    }
    const deal = this.db.get(item.id);
    if (!deal) return { id: item.id, key: item.key, status: 'error', message: 'Deal not found' };
    if (this.random() < this.config.itemFailureRate) {
      // The server answered but refused this deal (transient, e.g. locked); not cached so a retry can succeed.
      return { id: item.id, key: item.key, status: 'error', message: 'Deal is locked by another process' };
    }
    let result: ItemResult;
    if (deal.stage !== item.expected) {
      this.stats.conflicts++;
      result = { id: item.id, key: item.key, status: 'conflict', deal };
    } else if (deal.stage === item.target) {
      result = { id: item.id, key: item.key, status: 'ok', deal };
    } else {
      const now = this.now();
      const next = this.write({ ...deal, stage: item.target, stageChangedAt: now, lastActivityAt: now }, actor, !!written);
      written?.push({ id: next.id, stage: next.stage, version: next.version, seq: next.seq });
      this.stats.applied++;
      result = { id: item.id, key: item.key, status: 'ok', deal: next };
    }
    this.idem.set(item.key, result);
    return result;
  }

  /** `quiet`: part of a multi-deal action, announced once afterwards (see announce). */
  private write(deal: Deal, actor: Actor, quiet = false): Deal {
    const prev = this.db.get(deal.id)!;
    const stageChanged = deal.stage !== prev.stage;
    const next: Deal = {
      ...deal,
      // Stage attribution is kept separately: it's what conflicts are about.
      stageChangedAt: stageChanged ? this.now() : prev.stageChangedAt,
      stageChangedBy: stageChanged ? actor.user : prev.stageChangedBy,
      version: prev.version + 1,
      updatedAt: this.now(),
      updatedBy: actor.user,
      updatedBySession: actor.session,
      seq: ++this.seq,
    };
    this.db.set(next.id, next);
    if (next.owner !== prev.owner) this.indexOwner(next);
    this.writeListeners.forEach((l) => l(next));
    if (!quiet) this.push(next);
    return next;
  }

  /** One message for one action that changed several deals. */
  private announce(actor: Actor, deals: BulkChange['deals']) {
    if (!this.config.online || !deals.length) return; // offline clients catch up with changesSince()
    const c: BulkChange = { by: actor.user, session: actor.session, at: this.now(), deals };
    for (const l of this.bulkChangeListeners) setTimeout(() => l(c), this.random() * this.config.pushDelayMaxMs);
  }

  private push(deal: Deal) {
    // Offline clients don't receive live updates; they catch up with changesSince() on reconnect.
    if (!this.config.online) return;
    for (const l of this.pushListeners) {
      setTimeout(() => l(deal), this.random() * this.config.pushDelayMaxMs);
    }
  }

  private latency() {
    const { latencyMinMs: a, latencyMaxMs: b } = this.config;
    return a + this.random() * Math.max(0, b - a);
  }

  // ---- teammates -----------------------------------------------------------

  startTeammates() {
    if (this.teammateTimer) return;
    this.teammateTimer = setInterval(() => {
      this.carry += this.config.teammateEditsPerSec / 10;
      while (this.carry >= 1) {
        this.carry--;
        this.teammateEdit();
      }
    }, 100);
  }

  stopTeammates() {
    if (this.teammateTimer) clearInterval(this.teammateTimer);
    this.teammateTimer = null;
  }

  private pickTeammate() {
    const active = this.activeUsers();
    const pool = OWNERS.filter((o) => !active.has(o));
    return pool[Math.floor(this.random() * pool.length)] ?? 'Teammate';
  }

  /**
   * A deal for a background teammate to change: an open deal of someone who
   * does NOT have the app open. People testing change each other's deals by
   * hand (Rahul's tab, or the Simulator's bulk button), so their own boards
   * only change when they choose to.
   */
  private pickDeal(): Deal | undefined {
    const active = this.activeUsers();
    for (let tries = 0; tries < 20; tries++) {
      const deal = this.db.get(this.ids[Math.floor(this.random() * this.ids.length)])!;
      if (isOpen(deal.stage) && !active.has(deal.owner)) return deal;
    }
    return undefined;
  }

  /**
   * A simulated teammate changes a deal (the background teammates, and tests).
   * With an id it always changes the stage, so a conflict is guaranteed if
   * you're saving that deal.
   */
  teammateEdit(id?: string, kind?: 'stage' | 'value' | 'owner' | 'activity'): Deal | undefined {
    const deal = id ? this.db.get(id) : this.pickDeal();
    if (!deal) return;
    const now = this.now();
    const KIND_R = { stage: 0, value: 0.6, owner: 0.8, activity: 0.9 };
    const r = kind ? KIND_R[kind] : id ? 0 : this.random();
    let next: Deal;
    if (r < 0.55) {
      const i = STAGES.indexOf(deal.stage);
      const stage: Stage = id
        ? STAGES[(i + 1 + Math.floor(this.random() * (STAGES.length - 1))) % STAGES.length]
        : this.random() < 0.15 || i >= 4 ? 'lost' : STAGES[i + 1];
      next = { ...deal, stage, stageChangedAt: now, lastActivityAt: now };
    } else if (r < 0.75) {
      next = { ...deal, value: Math.round((deal.value * (0.8 + this.random() * 0.5)) / 1000) * 1000 };
    } else if (r < 0.85) {
      const pool = OWNERS.filter((o) => o !== deal.owner && !this.activeUsers().has(o)); // never handed to someone testing
      next = { ...deal, owner: pool[Math.floor(this.random() * pool.length)] };
    } else {
      next = { ...deal, lastActivityAt: now, nextStepAt: now + Math.ceil(this.random() * 10) * DAY };
    }
    return this.write(next, { user: this.pickTeammate(), session: SIM_SESSION });
  }

  /** Test hook: a teammate moves up to `n` of this user's open deals to Lost in one action (e.g. a cleanup). */
  teammateBulkMove(user: string, n = 40) {
    const by = { user: this.pickTeammate(), session: SIM_SESSION };
    const now = this.now();
    const written: BulkChange['deals'] = [];
    for (const id of this.byOwner.get(user) ?? []) {
      if (written.length >= n) break;
      const d = this.db.get(id)!;
      if (d.owner !== user || !isOpen(d.stage)) continue;
      const next = this.write({ ...d, stage: 'lost', stageChangedAt: now, lastActivityAt: now }, by, true);
      written.push({ id, stage: next.stage, version: next.version, seq: next.seq });
    }
    this.announce(by, written);
  }
}
