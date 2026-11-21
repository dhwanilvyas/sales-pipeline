import type { Actor, Api, BulkJob, BulkResult, BulkUpdate } from '@/entities/deal/deal.api';
import type { Query } from '@/entities/deal/deal.query';
import type { Deal, Stage } from '@/entities/deal/deal.types';
import type { JobTracker } from './history';
import type { HistoryEntry, Job, MoveEntry, Outcome } from './pipelineClient';

/** After a reload, finished server jobs younger than this still show in the tray (so you see how they ended). */
const RECENT_JOB_MS = 10 * 60_000;

/**
 * What bulk jobs need from the sync engine. The engine owns what each card
 * shows (its pending state); this file only talks to the server about jobs and
 * says what each result means for a card.
 */
export interface JobHost {
  readonly api: Api;
  readonly jobs: JobTracker;
  readonly me: string;
  newKey(): string;
  actor(): Actor;
  /** False (and the user is told why) while we can't reach the server. */
  canEdit(): boolean;
  /** The card shows `to` (Saving…) while the server works on it. */
  hold(job: Job, id: string, from: Stage, to: Stage): void;
  /** The job is done with this card: show the server's deal again. */
  release(job: Job, id: string): void;
  /** The server refused this deal: the card shows Not saved. */
  fail(job: Job, id: string, reason: string): void;
  /** Failed cards of this job back to Saving… (the server retries them). */
  unfail(job: Job): void;
  /** The stage the user currently sees for a deal. */
  stageShown(id: string): Stage | undefined;
  applyServer(deal: Deal): void;
  setOutcome(jobId: string, id: string, o: Outcome | null): void;
  pushHistory(entry: HistoryEntry): void;
  /** A small request with retries; null if it never got through. */
  call<T>(fn: () => Promise<T>, tries?: number): Promise<T | null>;
  notify(): void;
}

/**
 * "Select all" moves, run by the server as jobs.
 *
 * The client sends ONE request with the filter (plus a key, so a retried start
 * is still one job). The server picks the matching deals, works through them
 * in the background and pushes progress. Here we show the cards moved at once
 * and settle each as its result arrives: saved, failed (Retry) or skipped
 * (someone changed it after the job started). Stop, Undo and Retry failed are
 * server calls too, and after a reload or reconnect we ask the server for our
 * jobs and pick up where we were.
 */
export class BulkJobs {
  /** How to (re)start each job, for "Try again" when the start never reached the server. */
  private starts = new Map<string, () => void>();

  constructor(private host: JobHost) {}

  /** Listen for job progress. Returns the unsubscribe function. */
  connect() {
    return this.host.api.onBulkUpdate((u) => this.onUpdate(u));
  }

  /** Start a select-all move. `shown` are the selected cards, moved on screen right away. */
  start(filter: Query, target: Stage, shown: readonly MoveEntry[], label: string): Job | null {
    const h = this.host;
    if (!h.canEdit()) return null;
    const key = h.newKey(); // reused if the start is retried: still one job
    const entries = shown.filter((e) => e.expected !== target);
    return this.run(label, entries, () => h.api.startBulkMove({ key, label, filter, target }, h.actor()), true);
  }

  restart(jobId: string) {
    this.starts.get(jobId)?.();
  }

  /** Stop: the server skips what it hasn't done yet (and reports those deals as skipped). */
  stop(job: Job) {
    const serverId = job.server?.id;
    if (!serverId || job.server!.finished) return;
    job.cancelled = true;
    this.host.notify();
    void this.host.call(() => this.host.api.cancelBulk(serverId)).then((ok) => {
      if (ok === null) { job.cancelled = false; this.host.notify(); } // didn't get through: still running
    });
  }

  /** The newest running job (for Shift+S). */
  running(): Job | null {
    return this.host.jobs.list().find((j) => j.server?.id && !j.server.finished && !j.cancelled) ?? null;
  }

  retryFailed(job: Job) {
    const serverId = job.server?.id;
    if (!serverId) return;
    this.host.unfail(job);
    void this.host.call(() => this.host.api.retryBulkFailed(serverId)).then((snap) => snap && this.applySnapshot(job, snap));
  }

  /** Undo a job: the server moves back what it moved, where nobody changed it since. */
  undo(job: Job, entry: HistoryEntry) {
    const h = this.host;
    const serverId = job.server!.id!;
    const moved = [...job.outcomes].filter(([, o]) => o === 'ok').map(([id]) => id);
    const shown: MoveEntry[] = [];
    for (const id of moved) {
      const now = h.stageShown(id);
      const from = job.from.get(id);
      if (now && from && now !== from) shown.push({ id, expected: now, target: from });
    }
    if (!job.server!.finished) job.cancelled = true; // the server stops the job first
    const key = h.newKey();
    this.run(`Undo: ${entry.label}`, shown, () => h.api.undoBulk(serverId, key, h.actor()), false);
    return { label: entry.label, reverted: shown.length, skipped: moved.length - shown.length };
  }

  /** Our jobs on the server: after a reload, show them again; after a reconnect, catch up on progress. */
  async sync() {
    const h = this.host;
    const list = await h.call(() => h.api.bulkJobs(h.me), 1);
    if (!list) return;
    for (const snap of list) {
      let job = h.jobs.list().find((j) => j.server?.id === snap.id);
      if (!job) {
        if (snap.finished && Date.now() - snap.createdAt > RECENT_JOB_MS) continue;
        job = h.jobs.create(h.newKey(), snap.label, snap.deals.map((d) => ({ id: d.id, expected: d.from, target: d.to })));
        job.server = { id: snap.id, finished: snap.finished };
      }
      this.applySnapshot(job, snap);
    }
  }

  private run(label: string, shown: MoveEntry[], start: () => Promise<BulkJob>, recordHistory: boolean): Job {
    const h = this.host;
    const job = h.jobs.create(h.newKey(), label, shown);
    job.server = { id: null, finished: false };
    if (recordHistory) h.pushHistory({ label, items: [], jobId: job.id });
    const begin = async () => {
      job.server!.startError = undefined;
      for (const e of shown) h.hold(job, e.id, e.expected, e.target);
      h.notify();
      const snap = await h.call(start);
      if (!snap) {
        for (const id of job.ids) h.release(job, id); // cards go back; the tray offers Try again
        job.server!.startError = 'Could not reach the server to start this.';
        h.notify();
        return;
      }
      job.server!.id = snap.id;
      this.applySnapshot(job, snap);
    };
    this.starts.set(job.id, () => void begin());
    void begin();
    return job;
  }

  /** The server's full view of a job (after starting it, a reconnect or a reload). */
  private applySnapshot(job: Job, snap: BulkJob) {
    const h = this.host;
    const taken = new Set(snap.deals.map((d) => d.id));
    for (const id of job.ids) if (!taken.has(id)) h.release(job, id); // e.g. already in that stage
    job.ids = snap.deals.map((d) => d.id);
    job.total = job.ids.length;
    job.from = new Map(snap.deals.map((d) => [d.id, d.from]));
    const decided = new Set(snap.results.map((r) => r.id));
    for (const d of snap.deals) if (!decided.has(d.id)) h.hold(job, d.id, d.from, d.to);
    this.applyResults(job, snap.results);
    job.cancelled = snap.cancelled;
    job.server!.finished = snap.finished;
    h.notify();
  }

  private onUpdate(u: BulkUpdate) {
    const job = this.host.jobs.list().find((j) => j.server?.id === u.jobId);
    if (!job) return; // another tab's or user's job
    this.applyResults(job, u.results);
    job.cancelled = u.cancelled;
    job.server!.finished = u.finished;
    this.host.notify();
  }

  private applyResults(job: Job, results: readonly BulkResult[]) {
    const h = this.host;
    for (const r of results) {
      if (r.outcome === 'ok') h.applyServer(r.deal);
      else job.reasons.set(r.id, r.reason);
      if (r.outcome === 'failed') h.fail(job, r.id, r.reason);
      else h.release(job, r.id);
      h.setOutcome(job.id, r.id, r.outcome);
    }
  }
}
