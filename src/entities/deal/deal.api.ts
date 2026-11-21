import type { Deal, Stage } from './deal.types';
import type { Query } from './deal.query';

/**
 * The contract between the app and ANY backend (the fake one today, a real API
 * tomorrow). The sync engine depends only on this.
 */

/** Who is making a change: the person and which browser tab (session). */
export interface Actor {
  user: string;
  session: string;
}

/** One "move this deal" instruction. `expected` is a compare-and-set guard on the stage field. */
export interface MoveItem {
  id: string;
  expected: Stage;
  target: Stage;
  /** Idempotency key: re-sending the same key never applies the change twice. */
  key: string;
}

export type ItemResult =
  | { id: string; key: string; status: 'ok'; deal: Deal }
  | { id: string; key: string; status: 'conflict'; deal: Deal }
  | { id: string; key: string; status: 'error'; message: string };

export class NetworkError extends Error {
  constructor(message: string, readonly offline = false) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Most deals one `move` request may carry. Bigger changes are bulk jobs: send a filter, not IDs. */
export const MAX_MOVE_ITEMS = 1000;

/** One deal's result inside a bulk job. */
export type BulkResult =
  | { id: string; outcome: 'ok'; deal: Deal }
  /** Not moved: no longer matched the filter (someone changed it), changed since (undo), or the job was stopped. */
  | { id: string; outcome: 'skipped'; reason: string }
  /** The server refused this deal (e.g. locked). Can be retried. */
  | { id: string; outcome: 'failed'; reason: string };

/** A bulk job as the server reports it. `results` holds every deal decided so far. */
export interface BulkJob {
  id: string;
  label: string;
  user: string;
  /** Every deal in the job, with its stage before the move. */
  deals: { id: string; from: Stage; to: Stage }[];
  results: BulkResult[];
  cancelled: boolean;
  finished: boolean;
  createdAt: number;
}

/** Progress of a running job: the results decided since the last update. */
export interface BulkUpdate {
  jobId: string;
  results: BulkResult[];
  cancelled: boolean;
  finished: boolean;
}

/**
 * One action by one person that changed several deals: a hand-picked move or a
 * finished bulk job. Sent once, instead of one push per deal. It carries only
 * what changed (the new stage and version per deal), so the client patches its
 * own copies; a deal whose version skips ahead is fetched instead (it missed
 * something in between).
 */
export interface BulkChange {
  by: string;
  session: string;
  at: number;
  deals: { id: string; stage: Stage; version: number; seq: number }[];
}

/** What the sync engine needs from the backend. */
export interface Api {
  listDeals(): Promise<Deal[]>;
  /** Move up to MAX_MOVE_ITEMS deals, each guarded by the stage the user saw. */
  move(items: MoveItem[], actor: Actor): Promise<ItemResult[]>;
  /** One deal changed (by anyone, including this user in another tab). */
  onPush(listener: (deal: Deal) => void): () => void;
  /** One action changed several deals (see BulkChange). */
  onBulkChange(listener: (change: BulkChange) => void): () => void;
  /** Every deal changed after sequence `seq` (to catch up after missing pushes while offline). */
  changesSince(seq: number): Promise<Deal[]>;

  // ---- bulk jobs: "move everything matching this filter", run by the server ----
  /** Start a job. The server re-checks the filter for each deal as it goes. Same `key` = same job (safe to retry). */
  startBulkMove(req: { key: string; label: string; filter: Query; target: Stage }, actor: Actor): Promise<BulkJob>;
  /** Stop a job: deals not done yet are skipped. */
  cancelBulk(jobId: string): Promise<void>;
  /** Try the deals the server refused again, in the same job. */
  retryBulkFailed(jobId: string): Promise<BulkJob>;
  /** A new job that moves back what this job moved, where nobody changed it since. Same `key` = same job. */
  undoBulk(jobId: string, key: string, actor: Actor): Promise<BulkJob>;
  /** This user's running and recent jobs (after a reload or reconnect). */
  bulkJobs(user: string): Promise<BulkJob[]>;
  onBulkUpdate(listener: (u: BulkUpdate) => void): () => void;
}
