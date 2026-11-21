import type { HistoryEntry, Job, MoveEntry, Outcome } from './pipelineClient';

/** What the user did: bulk jobs (with per-deal outcomes) and the undo stack. */

/** Jobs kept for the tray and the Jobs menu (recent ones, including dismissed). */
const MAX_JOBS = 10;
const MAX_UNDO = 50;

export function isJobDone(job: Job) {
  const c = job.counts;
  return c.ok + c.failed + c.conflict + c.skipped >= job.total;
}

/** Bulk moves in progress or recently finished (the job tray). */
export class JobTracker {
  private jobs = new Map<string, Job>();

  create(id: string, label: string, entries: readonly MoveEntry[]): Job {
    const ids = entries.map((e) => e.id);
    const job: Job = {
      id, label, ids, total: ids.length,
      from: new Map(entries.map((e) => [e.id, e.expected])),
      counts: { ok: 0, failed: 0, conflict: 0, skipped: 0 },
      outcomes: new Map(),
      reasons: new Map(),
      cancelled: false,
      dismissed: false,
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    for (const old of this.list().slice(MAX_JOBS)) this.jobs.delete(old.id); // keep the list short
    return job;
  }

  get(id: string) {
    return this.jobs.get(id);
  }

  /** Newest first. */
  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Hidden from the tray, still listed under Jobs (recent jobs). */
  dismiss(id: string) {
    const job = this.jobs.get(id);
    if (job) job.dismissed = true;
  }

  /** Record one deal's outcome (null = not decided yet, e.g. retrying). Returns whether anything changed. */
  setOutcome(jobId: string, id: string, o: Outcome | null): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    const prev = job.outcomes.get(id);
    if (prev === o) return false;
    if (prev) job.counts[prev]--;
    if (o) {
      job.outcomes.set(id, o);
      job.counts[o]++;
    } else job.outcomes.delete(id);
    return true;
  }
}

export class UndoHistory {
  private entries: HistoryEntry[] = [];

  push(entry: HistoryEntry) {
    this.entries.push(entry);
    if (this.entries.length > MAX_UNDO) this.entries.shift();
  }

  peek(): HistoryEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  pop() {
    return this.entries.pop();
  }
}
