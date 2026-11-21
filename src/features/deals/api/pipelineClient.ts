import {
  MAX_MOVE_ITEMS, NetworkError, type Actor, type Api, type BulkChange, type ItemResult, type MoveItem,
} from '@/entities/deal/deal.api';
import type { Query } from '@/entities/deal/deal.query';
import { STAGE_LABEL, type Deal, type Stage } from '@/entities/deal/deal.types';
import { fmtNum } from '@/shared/utils/format';
import { ConnectionState } from './connection';
import { groupConflicts } from './conflicts';
import { isJobDone, JobTracker, UndoHistory } from './history';
import { BulkJobs, type JobHost } from './bulkJobs';

/**
 * PipelineClient — the client-side sync engine.
 *
 * Two layers of state:
 *   server:  last *confirmed* version of every deal (from load, save responses, pushes).
 *            Only ever replaced by a strictly newer `version`, so late/out-of-order
 *            pushes can never roll data back.
 *   pending: the user's unconfirmed intent per deal. The UI shows `desired`
 *            immediately (optimistic), with a visible save status.
 *
 * Per deal there is at most ONE request in flight. Edits made while a request is
 * in flight just update `desired`; when the request finishes the engine sends
 * the latest intent (coalescing rapid A→B→C→D into at most two requests).
 *
 * Every request carries:
 *   - `expected`: the stage this chain of edits started from (compare-and-set).
 *     If a teammate changed the stage in between, the server refuses → conflict.
 *     Teammates changing *other* fields (value, owner…) never cause a conflict.
 *   - `key`: an idempotency key that is reused on every retry of that request,
 *     so a save whose response was lost is never applied twice.
 *
 * Connection: while offline or while the server is unreachable, no NEW change
 * can start (the board may be out of date; see canEdit). Changes already made
 * before the connection dropped aren't failed or lost: they WAIT ("waiting to
 * send"), are kept in an outbox so they survive a reload, and sync when the
 * connection is back, still guarded by compare-and-set. On reconnect the
 * client also fetches changes it missed.
 *
 * Moving many deals:
 *   - hand-picked (up to MAX_MOVE_ITEMS): the same path as single moves, in
 *     one request, each deal guarded by the stage the user saw.
 *   - "select all" on a view: one request with the FILTER. The server runs it
 *     as a job (progress, Stop, Undo, Retry failed); the client shows the cards
 *     moved meanwhile and applies the server's per-deal results.
 *
 * Helpers: connection.ts (online/offline/unreachable), bulkJobs.ts (select-all
 * jobs run by the server), history.ts (job tracking, undo), conflicts.ts (grouping).
 */

// ---- public types ----------------------------------------------------------

/** 'waiting' = kept locally because there is no connection; will sync automatically. */
export type SaveStatus = 'queued' | 'saving' | 'retrying' | 'waiting' | 'failed' | 'conflict';

export type Connection = 'online' | 'offline' | 'unreachable';

/**
 * Where the client keeps a copy of its unsaved changes (sessionStorage + IndexedDB in the app,
 * memory in tests). Reading them back is the app's job: it asks the user, then calls continueLeftovers.
 */
export interface OutboxStore {
  save(entries: StoredPending[]): void;
}

/** One unsaved change as stored in the outbox. */
export interface StoredPending {
  id: string;
  origin: Stage;
  desired: Stage;
  req: { target: Stage; key: string; sends: number } | null;
  status: 'queued' | 'failed' | 'conflict';
}

/**
 * The competing change behind a conflict, read from the server's CURRENT copy
 * of the deal (so it stays right if the deal changes again). `self` = same user,
 * another tab.
 */
export interface Theirs {
  stage: Stage;
  by: string;
  self: boolean;
  at: number;
}

export interface ConflictGroup {
  key: string;
  /** Who moved these deals, and where to. */
  by: string;
  self: boolean;
  stage: Stage;
  ids: string[];
  /** What I wanted for them, by stage (usually one stage: the bulk move's target). */
  wanted: Partial<Record<Stage, number>>;
  latestAt: number;
}

export interface DealView {
  /** The deal as the user should see it (their pending stage applied). */
  deal: Deal;
  serverStage: Stage;
  status: SaveStatus | null;
  error?: string;
  theirs?: Theirs;
  /** Last change came from someone else (teammate or my other tab). */
  external: boolean;
  /** I explicitly accepted this version ("Keep theirs" on a conflict): show it where it is, like my own change. */
  accepted?: boolean;
}

export type Outcome = 'ok' | 'failed' | 'conflict' | 'skipped';

export interface Job {
  id: string;
  label: string;
  /**
   * Set for a bulk job the server runs (select all on a view): its id there once started.
   * Hand-picked moves (no server job) are tracked here only.
   */
  server?: { id: string | null; finished: boolean; startError?: string };
  ids: string[];
  /** Each deal's stage before the move (for the job's details list). */
  from: Map<string, Stage>;
  total: number;
  counts: Record<Outcome, number>;
  outcomes: Map<string, Outcome>;
  /** Why a deal was skipped or failed, when the server said (for Details). */
  reasons: Map<string, string>;
  cancelled: boolean;
  /** Closed in the tray; still in the Jobs menu. */
  dismissed: boolean;
  createdAt: number;
}

export interface MoveEntry {
  id: string;
  /** Stage the user saw when they decided (selection time for bulk). */
  expected: Stage;
  target: Stage;
}

export interface HistoryEntry {
  label: string;
  items: { id: string; from: Stage; to: Stage }[];
  jobId?: string;
}

/** One action by someone else: "Rahul moved Acme to Won", or "Riya moved 40 deals to Lost". */
export interface RemoteChange {
  /** The deal (the first one, for an action on several). */
  id: string;
  /** The deal's name, or "40 deals". */
  name: string;
  /** Every deal in the action (several only). */
  ids?: string[];
  /** Each deal before and after (for "View": exactly what changed on which deals). */
  deals: { id: string; from: Stage; to: Stage; fromOwner: string; toOwner: string; fromValue: number; toValue: number }[];
  count: number;
  /** How many of them are (or were) this user's deals: those get a toast. */
  forMe: number;
  by: string;
  /** The same user, in another tab. */
  self: boolean;
  at: number;
  what: string;
  /** Missed while offline, fetched on reconnect. */
  offline?: boolean;
}

export interface ClientOptions {
  me: string;
  /** Identifies this tab. Changes from other sessions count as external, even by the same user. */
  session: string;
  /** Requests in flight at once (hand-picked and single moves). */
  concurrency?: number;
  maxAutoRetries?: number;
  backoffMs?: number;
  /** First wait before re-testing an unreachable server (doubles up to 30s). */
  probeMs?: number;
  outbox?: OutboxStore;
}

// ---- internals ---------------------------------------------------------------

interface SaveRequest {
  target: Stage;
  key: string;
  sends: number;
}

/** The user's unconfirmed change to one deal. */
interface Pending {
  origin: Stage;
  desired: Stage;
  /** Unresolved request. Kept after a failure: its outcome is unknown until re-sent. */
  req: SaveRequest | null;
  status: SaveStatus;
  autoRetries: number;
  inFlight: boolean;
  /** Waiting in the send queue. */
  enqueued: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  error?: string;
  jobId?: string;
  /** Part of a server bulk job: the server is doing it, nothing to send (until the user acts on it by hand). */
  byServer?: boolean;
}

let keySeq = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}-${++keySeq}`;

export class PipelineClient {
  /** Who this tab acts as (fixed for the tab's lifetime). */
  readonly me: string;
  readonly session: string;
  private server = new Map<string, Deal>();
  private order: string[] = [];
  private pending = new Map<string, Pending>();
  private views = new Map<string, DealView>();

  /** Deals ready to send; flushed once per tick into requests of up to MAX_MOVE_ITEMS. */
  private ready = new Set<string>();
  private batches: string[][] = [];
  private active = 0;
  private flushScheduled = false;

  private jobs = new JobTracker();
  /** "Select all" moves the server runs as jobs (bulkJobs.ts). */
  private bulk: BulkJobs;
  private history = new UndoHistory();
  /** Deals changed by teammates since the user's view was last (re)built. */
  private external = new Set<string>();
  /** Deals whose current version I accepted by choosing "Keep theirs" (deal id → version). */
  private accepted = new Map<string, number>();
  private activity: RemoteChange[] = [];

  private listeners = new Set<() => void>();
  private rev = 0;
  private notifyScheduled = false;
  private unsubPush: (() => void) | null = null;
  private unsubJobs: (() => void) | null = null;
  private unsubBulkChange: (() => void) | null = null;
  loaded = false;

  /** Highest change sequence seen; used to fetch missed changes after reconnecting. */
  private lastSeq = 0;
  private outbox: OutboxStore | null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private outboxIds = new Set<string>();

  private readonly concurrency: number;
  private readonly maxAutoRetries: number;
  private readonly backoffMs: number;

  constructor(private api: Api, opts: ClientOptions) {
    this.me = opts.me;
    this.session = opts.session;
    this.concurrency = opts.concurrency ?? 4;
    this.maxAutoRetries = opts.maxAutoRetries ?? 3;
    this.backoffMs = opts.backoffMs ?? 600;
    this.outbox = opts.outbox ?? null;
    this.bulk = new BulkJobs(this.jobHost());
    this.conn = new ConnectionState(opts.probeMs ?? 3000, {
      change: () => {
        this.views.clear(); // statuses shown depend on the connection
        this.notify();
      },
      resume: (catchUp) => {
        if (catchUp) void this.catchUp();
        this.resume();
      },
    });
  }

  private readonly conn: ConnectionState;

  /** Connection as the client sees it (browser/simulator offline, or server unreachable). */
  get connection(): Connection {
    return this.conn.state;
  }
  /** When we lost the connection (for "offline since 10:42"). */
  get offlineSince() {
    return this.conn.offlineSince;
  }
  /** A reconnect check is running (unreachable, trying again now). */
  get checkingConnection() {
    return this.conn.checking;
  }
  /** When the next automatic reconnect attempt happens (unreachable only). */
  get nextProbeAt() {
    return this.conn.nextProbeAt;
  }

  // ---- lifecycle & subscription -------------------------------------------

  private loading: Promise<void> | null = null;

  /** Idempotent: safe to call twice (React StrictMode mounts effects twice in dev). */
  load(): Promise<void> {
    return (this.loading ??= this.doLoad());
  }

  private async doLoad() {
    // Subscribe before loading so no change is missed; version checks dedupe overlap.
    this.unsubPush = this.api.onPush((d) => this.applyServer(d));
    this.unsubJobs = this.bulk.connect();
    this.unsubBulkChange = this.api.onBulkChange((c) => this.applyBulkChange(c));
    const deals = await this.api.listDeals();
    for (const d of deals) this.applyServer(d);
    this.order = deals.map((d) => d.id);
    this.loaded = true;
    this.notify();
    void this.bulk.sync(); // bulk jobs still running (or just finished) from before a reload
  }

  destroy() {
    this.unsubPush?.();
    this.unsubJobs?.();
    this.unsubBulkChange?.();
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.conn.destroy();
    this.flushOutbox();
  }

  /** Demo data was reset on the server: every local change refers to data that no longer exists. */
  discardAll() {
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    this.flushOutbox();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  getRev = () => this.rev;

  private mark(id: string) {
    this.views.delete(id);
    if (this.outbox && (this.pending.has(id) || this.outboxIds.has(id))) this.schedulePersist();
    this.notify();
  }

  /** Batched: many changes in one tick produce one UI update. */
  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.rev++;
      this.listeners.forEach((l) => l());
    });
  }

  // ---- reads ---------------------------------------------------------------

  getView(id: string): DealView | undefined {
    const cached = this.views.get(id);
    if (cached) return cached;
    const s = this.server.get(id);
    if (!s) return undefined;
    const p = this.pending.get(id);
    const v: DealView = p
      ? {
          deal: p.desired === s.stage ? s : { ...s, stage: p.desired },
          serverStage: s.stage,
          status: this.displayStatus(p),
          error: p.error,
          theirs: p.status === 'conflict' ? this.theirsOf(s) : undefined,
          external: this.isExternal(s),
        }
      : { deal: s, serverStage: s.stage, status: null, external: this.isExternal(s), accepted: this.accepted.get(id) === s.version };
    this.views.set(id, v);
    return v;
  }

  /** Without a connection, anything not yet confirmed is simply waiting (not "saving", not failed). */
  private displayStatus(p: Pending): SaveStatus {
    if (this.connection !== 'online' && (p.status === 'queued' || p.status === 'retrying' || p.status === 'saving')) return 'waiting';
    return p.status;
  }

  /** Changed after load by someone else (a teammate or my other tab). Seed data doesn't count. */
  private isExternal(d: Deal) {
    return d.updatedBySession !== this.session && d.updatedBySession !== 'seed';
  }

  /** Every deal as the user should see it (their pending stages applied), in load order. */
  *rows(): Iterable<Deal> {
    for (const id of this.order) {
      const v = this.getView(id)!;
      yield v.deal;
    }
  }

  /** Deals whose save failed for good (for the Unsaved changes panel). */
  failedIds(): string[] {
    const out: string[] = [];
    for (const [id, p] of this.pending) if (p.status === 'failed') out.push(id);
    return out;
  }

  summary() {
    let saving = 0, waiting = 0, failed = 0, conflicts = 0, jobConflicts = 0;
    for (const p of this.pending.values()) {
      const s = this.displayStatus(p);
      if (s === 'failed') failed++;
      else if (s === 'conflict') {
        conflicts++;
        if (p.jobId) jobConflicts++;
      } else if (s === 'waiting') waiting++;
      else saving++;
    }
    /** jobConflicts: from bulk moves (reviewed together when the job ends, not toasted one by one). */
    return { saving, waiting, failed, conflicts, jobConflicts };
  }

  /** A job's conflicts the user hasn't resolved yet. */
  openConflicts(job: Job): number {
    let n = 0;
    for (const [id, o] of job.outcomes) {
      if (o !== 'conflict') continue;
      const p = this.pending.get(id);
      if (p?.status === 'conflict' && p.jobId === job.id) n++;
    }
    return n;
  }

  /**
   * New changes need the server. While offline or unreachable we don't receive
   * teammates' changes either, so the board may be out of date: on a pipeline
   * 20 people edit at once, changes made on it would come back as conflicts.
   * Changes already made before the connection dropped are kept and sent later.
   */
  canEdit() {
    return this.connection === 'online';
  }

  private blockedListeners = new Set<() => void>();

  /** Called when a new change is refused because we can't reach the server (the app explains it). */
  onBlocked(l: () => void) {
    this.blockedListeners.add(l);
    return () => void this.blockedListeners.delete(l);
  }

  /** Returns true if a new change may start; otherwise tells the listeners and returns false. */
  ensureCanEdit(): boolean {
    if (this.canEdit()) return true;
    this.blockedListeners.forEach((l) => l());
    return false;
  }

  /** Jobs shown in the tray (newest first). */
  getJobs(): Job[] {
    return this.jobs.list().filter((j) => !j.dismissed);
  }

  /** Recent jobs, including ones closed in the tray (the Jobs menu). */
  recentJobs(): Job[] {
    return this.jobs.list();
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  dismissJob(id: string) {
    this.jobs.dismiss(id);
    this.notify();
  }

  /** Back into the tray (from the Jobs menu). */
  reopenJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.dismissed = false;
    this.notify();
  }

  /** Shift+S: stop the newest running server job. Returns it, or null if none is running. */
  stopRunningJob(): Job | null {
    const job = this.bulk.running();
    if (job) this.bulk.stop(job);
    return job;
  }

  peekHistory(): HistoryEntry | undefined {
    return this.history.peek();
  }

  /** Deals changed by others since the view was last refreshed (anywhere in the pipeline; the view filters them). */
  externalIds(): Iterable<string> {
    return this.external;
  }

  externalChangeCount() {
    return this.external.size;
  }

  clearExternal() {
    if (!this.external.size) return;
    this.external.clear();
    this.notify(); // the pill's count drops to 0 now, not at the next change
  }

  /** Has someone else changed this deal since the view was last refreshed? */
  hasExternalChange(id: string) {
    return this.external.has(id);
  }

  /** Changes made by others (newest first), optionally for one deal. */
  activityFor(id: string) {
    return this.activity.filter((a) => a.id === id);
  }

  recentActivity() {
    return this.activity;
  }

  /** Nothing will happen until the user (or the connection) does something. Queued work counts as idle while disconnected. */
  isIdle() {
    const waiting = this.connection !== 'online';
    if (this.active || (!waiting && (this.ready.size || this.batches.length))) return false;
    for (const p of this.pending.values()) if (p.inFlight || p.timer || (!waiting && p.enqueued)) return false;
    for (const j of this.jobs.list()) if (j.server && !j.server.finished && !j.server.startError && !waiting) return false;
    return true;
  }

  // ---- incoming server state ----------------------------------------------

  /**
   * Accept only strictly newer versions. Whether the change arrives by push or
   * inside a save/conflict response, if it came from another session (a
   * teammate or my other tab) it counts as an external update.
   */
  private applyServer(deal: Deal): boolean {
    const prev = this.accept(deal);
    if (prev === null) return false;
    if (prev && this.fromOthers(deal)) this.record([{ prev, next: deal }]);
    return true;
  }

  /** Take a strictly newer version of a deal. Returns the version it replaced, or null if it wasn't newer. */
  private accept(deal: Deal): Deal | undefined | null {
    if (deal.seq > this.lastSeq) this.lastSeq = deal.seq;
    const prev = this.server.get(deal.id);
    if (prev && prev.version >= deal.version) return null;
    this.server.set(deal.id, deal);
    this.mark(deal.id);
    const p = this.pending.get(deal.id);
    if (p?.status === 'conflict' && deal.stage === p.desired) this.finish(deal.id, p); // someone made my change for me
    if (prev && this.fromOthers(deal)) this.external.add(deal.id);
    return prev;
  }

  /** Changed after load by another session (a teammate, or my other tab): it waits for "Apply". */
  private fromOthers(deal: Deal) {
    return this.loaded && deal.updatedBySession !== this.session;
  }

  /**
   * One action changed several deals ("Riya moved 40 deals to Lost"). The
   * message only says what changed, so patch our copies. A deal whose version
   * skips ahead missed a change in between: fetch it instead of guessing.
   */
  private applyBulkChange(c: BulkChange) {
    const before = this.lastSeq;
    const changes: { prev: Deal; next: Deal }[] = [];
    let gap = false;
    for (const e of c.deals) {
      const old = this.server.get(e.id);
      if (!old || old.version >= e.version) continue;
      if (old.version !== e.version - 1) { gap = true; continue; }
      const moved = old.stage !== e.stage;
      const next: Deal = {
        ...old, stage: e.stage, version: e.version, seq: e.seq, updatedAt: c.at, updatedBy: c.by, updatedBySession: c.session,
        ...(moved ? { stageChangedAt: c.at, stageChangedBy: c.by, lastActivityAt: c.at } : {}),
      };
      if (this.accept(next) && this.fromOthers(next)) changes.push({ prev: old, next });
    }
    if (changes.length) this.record(changes);
    if (gap) void this.fetchSince(before);
  }

  /**
   * Note others' changes for the updates list and toasts: one entry per person
   * and kind of change, so 40 moves by Riya are one line, not 40.
   */
  private record(changes: { prev: Deal; next: Deal }[], offline = false) {
    const groups = new Map<string, { prev: Deal; next: Deal }[]>();
    for (const c of changes) {
      const key = `${c.next.updatedBy}|${describe(c.prev, c.next)}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const list of groups.values()) {
      const first = list[0].next;
      this.activity.unshift({
        id: first.id,
        name: list.length === 1 ? first.name : `${list.length} deals`,
        ids: list.length > 1 ? list.map((c) => c.next.id) : undefined,
        deals: list.map((c) => ({
          id: c.next.id, from: c.prev.stage, to: c.next.stage, fromOwner: c.prev.owner, toOwner: c.next.owner, fromValue: c.prev.value, toValue: c.next.value,
        })),
        count: list.length,
        forMe: list.filter((c) => c.prev.owner === this.me || c.next.owner === this.me).length,
        by: first.updatedBy,
        self: first.updatedBy === this.me,
        at: first.updatedAt,
        what: describe(list[0].prev, first),
        offline,
      });
    }
    this.activity = this.activity.slice(0, 200);
  }

  // ---- connection ----------------------------------------------------------

  /** Called by the app from browser online/offline events and the simulator's switch. */
  setOnline(online: boolean) {
    this.conn.setOnline(online);
  }

  /** "Retry now" on the unreachable banner. */
  retryNow() {
    this.conn.retryNow();
  }

  /** Re-queue everything that was waiting for a connection. */
  private resume() {
    for (const [id, p] of this.pending) {
      if (p.status === 'queued' || p.status === 'retrying' || p.status === 'saving') this.pump(id);
    }
    this.drain();
  }

  /** Fetch changes we missed while disconnected (pushes don't arrive then). */
  private async catchUp() {
    await this.fetchSince(this.lastSeq, true);
    void this.bulk.sync(); // job progress sent while we were away
  }

  /** Every deal changed after `seq`: after a reconnect, or to fill a gap in a bulk change. */
  private async fetchSince(seq: number, offline = false) {
    try {
      const deals = await this.api.changesSince(seq);
      const changes: { prev: Deal; next: Deal }[] = [];
      for (const d of deals) {
        const prev = this.accept(d);
        if (prev && this.fromOthers(d)) changes.push({ prev, next: d });
      }
      if (changes.length) this.record(changes, offline);
    } catch {
      /* still flaky: the next reconnect tries again */
    }
  }

  // ---- outbox (survives reloads) ------------------------------------------

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.flushOutbox(), 500);
  }

  /** Write unsaved changes to the outbox now (also called on page hide). */
  flushOutbox() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    if (!this.outbox) return;
    const entries: StoredPending[] = [];
    for (const [id, p] of this.pending) {
      if (p.byServer) continue; // the server is doing it; nothing to re-send after a reload
      entries.push({
        id, origin: p.origin, desired: p.desired,
        req: p.req ? { ...p.req } : null,
        status: p.status === 'failed' || p.status === 'conflict' ? p.status : 'queued',
      });
    }
    this.outbox.save(entries);
    this.outboxIds = new Set(this.pending.keys());
  }

  /**
   * Take back unsaved changes from before a reload or a closed tab, once the
   * user said Continue. Requests keep their idempotency keys and expected values, so
   * replaying is safe: a change that already went through is not applied
   * twice, and one a teammate has since overridden comes back as a conflict.
   * Several changes become a job, so the tray shows progress, conflicts,
   * Details and Cancel, like the original move. Returns how many were taken.
   */
  private adopt(entries: readonly StoredPending[], label: (n: number) => string): number {
    const ids: string[] = [];
    for (const e of entries) {
      if (!this.server.has(e.id) || this.pending.has(e.id)) continue;
      this.pending.set(e.id, {
        origin: e.origin, desired: e.desired, req: e.req ? { ...e.req } : null,
        status: e.status, autoRetries: 0, inFlight: false, enqueued: false, timer: null,
        error: e.status === 'failed' ? 'Not saved before the page was closed' : undefined,
      });
      this.views.delete(e.id);
      ids.push(e.id);
    }
    if (ids.length > 1) {
      const moves = ids.map((id) => { const p = this.pending.get(id)!; return { id, expected: p.origin, target: p.desired }; });
      const job = this.jobs.create(newKey(), label(ids.length), moves);
      for (const id of ids) {
        const p = this.pending.get(id)!;
        p.jobId = job.id;
        if (p.status === 'conflict' || p.status === 'failed') this.setOutcome(job.id, id, p.status);
      }
    }
    for (const id of ids) this.pump(id);
    if (ids.length) this.schedulePersist(); // now this tab's to keep safe
    return ids.length;
  }

  /**
   * Changes left over from a reload or a closed tab: which ones still need doing,
   * checked against the latest data. Already done (the deal is in that stage)
   * or deleted deals are dropped; `changedSince` counts deals someone moved
   * meanwhile (sending those will ask the user: conflict, never an overwrite).
   */
  checkLeftovers(entries: readonly StoredPending[]): { entries: StoredPending[]; changedSince: number } {
    const byId = new Map<string, StoredPending>();
    for (const e of entries) {
      const s = this.server.get(e.id);
      if (!s || s.stage === e.desired || this.pending.has(e.id)) continue;
      byId.set(e.id, e);
    }
    let changedSince = 0;
    for (const e of byId.values()) if (this.server.get(e.id)!.stage !== e.origin) changedSince++;
    return { entries: [...byId.values()], changedSince };
  }

  /** The user chose to continue unsaved changes from before a reload or a closed tab. */
  continueLeftovers(entries: readonly StoredPending[]): number {
    if (!this.ensureCanEdit()) return 0;
    const n = this.adopt(this.checkLeftovers(entries).entries, (k) => `Finishing ${fmtNum(k)} unsaved changes`);
    this.notify();
    return n;
  }

  // ---- user intents --------------------------------------------------------

  /** Move a single deal (the common, keyboard-driven case). Undoable. Returns whether it was moved. */
  move(id: string, target: Stage): boolean {
    const v = this.getView(id);
    if (!v || v.deal.stage === target) return false;
    if (!this.ensureCanEdit()) return false;
    this.moveMany([{ id, expected: v.deal.stage, target }], `Moved ${v.deal.name} → ${STAGE_LABEL[target]}`);
    return true;
  }

  /**
   * Move hand-picked deals (up to MAX_MOVE_ITEMS): one request, each deal
   * guarded by the stage the user saw. Returns the Job tracking it (multi-deal only).
   */
  moveMany(entries: MoveEntry[], label: string, opts: { recordHistory?: boolean } = {}): Job | null {
    const effective = entries.filter((e) => e.expected !== e.target);
    if (!effective.length) return null;
    if (!this.ensureCanEdit()) return null;
    if (effective.length > MAX_MOVE_ITEMS) return null; // UI explains: use select all (a server job) instead
    const job = effective.length > 1 ? this.jobs.create(newKey(), label, effective) : null;
    for (const e of effective) {
      const r = this.setStage(e.id, e.target, e.expected, job?.id);
      if (r === 'noop' && job) this.setOutcome(job.id, e.id, 'ok');
    }
    if (opts.recordHistory !== false) {
      this.history.push({ label, items: effective.map((e) => ({ id: e.id, from: e.expected, to: e.target })), jobId: job?.id });
    }
    this.notify();
    return job;
  }

  /**
   * Undo the last action. Only reverts deals still showing what we set; each
   * revert is itself guarded by compare-and-set, so if a teammate changed the
   * deal since, the undo reports a conflict instead of clobbering their change.
   */
  undo(): { label: string; reverted: number; skipped: number; blocked?: boolean } | null {
    const entry = this.history.peek();
    if (!entry) return null;
    if (!this.ensureCanEdit()) return { label: entry.label, reverted: 0, skipped: 0, blocked: true };
    const job = entry.jobId ? this.jobs.get(entry.jobId) : undefined;
    if (job?.server) {
      if (!job.server.id) return { label: entry.label, reverted: 0, skipped: 0, blocked: true };
      this.history.pop();
      return this.bulk.undo(job, entry);
    }
    this.history.pop();
    const entries: MoveEntry[] = [];
    for (const it of entry.items) {
      const v = this.getView(it.id);
      if (v && v.deal.stage === it.to) entries.push({ id: it.id, expected: it.to, target: it.from });
    }
    this.moveMany(entries, `Undo: ${entry.label}`, { recordHistory: false });
    this.notify();
    return { label: entry.label, reverted: entries.length, skipped: entry.items.length - entries.length };
  }

  retry(id: string) {
    const p = this.pending.get(id);
    if (!p || p.status !== 'failed') return;
    if (!this.ensureCanEdit()) return;
    p.status = 'queued';
    p.autoRetries = 0;
    p.error = undefined;
    p.byServer = false; // retried by hand: sent like any move
    if (p.jobId) this.setOutcome(p.jobId, id, null);
    this.mark(id);
    this.pump(id);
  }

  /** Retry every failed save: a server job's failures are retried by the server, the rest by us. */
  retryAll() {
    if (!this.ensureCanEdit()) return;
    const serverJobs = new Set<string>();
    for (const [id, p] of this.pending) {
      if (p.status !== 'failed') continue;
      if (p.byServer && p.jobId) serverJobs.add(p.jobId);
      else this.retry(id);
    }
    for (const jobId of serverJobs) this.retryJobFailed(jobId);
  }

  /** "Retry N failed" on a job. */
  retryJobFailed(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || !this.ensureCanEdit()) return;
    if (job.server) return this.bulk.retryFailed(job); // the server retries them, in the same job
    for (const [id, o] of job.outcomes) if (o === 'failed') this.retry(id);
  }

  /** Give up on a failed change and go back to what the server has. */
  discard(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.status === 'conflict') return this.keepTheirs(id);
    if (p.status !== 'failed') return;
    if (!this.ensureCanEdit()) return; // discarding sends a request too
    // The failed request may or may not have been applied (lost response).
    // Re-sending it is safe (idempotent) and tells us; then revert if needed.
    this.setStage(id, p.origin, undefined, p.jobId);
  }

  keepTheirs(id: string) {
    const p = this.pending.get(id);
    if (!p || p.status !== 'conflict') return;
    this.pending.delete(id);
    // I've seen their change and chose it: nothing left to "apply" for this deal.
    const s = this.server.get(id);
    if (s) this.accepted.set(id, s.version);
    this.external.delete(id);
    this.mark(id);
  }

  applyMine(id: string) {
    const p = this.pending.get(id);
    if (!p || p.status !== 'conflict') return;
    if (!this.ensureCanEdit()) return;
    // Sent with THEIR stage as the expected value: if it changes yet again, that's a new conflict.
    this.setStage(id, p.desired, undefined, p.jobId);
  }

  /** Resolve many conflicts at once (e.g. one group). Returns how many were resolved. */
  resolveConflicts(ids: readonly string[], choice: 'theirs' | 'mine'): number {
    if (choice === 'mine' && !this.ensureCanEdit()) return 0;
    let n = 0;
    for (const id of ids) {
      if (this.pending.get(id)?.status !== 'conflict') continue;
      if (choice === 'theirs') this.keepTheirs(id);
      else this.applyMine(id);
      n++;
    }
    this.notify();
    return n;
  }

  /** Conflicts grouped by what the other person did, biggest group first (see conflicts.ts). */
  conflictGroups(): ConflictGroup[] {
    return groupConflicts(this.conflicts());
  }

  private *conflicts() {
    for (const [id, p] of this.pending) {
      const s = p.status === 'conflict' ? this.server.get(id) : undefined;
      if (s) yield { id, wanted: p.desired, theirs: this.theirsOf(s) };
    }
  }

  private theirsOf(s: Deal): Theirs {
    return { stage: s.stage, by: s.stageChangedBy, self: s.stageChangedBy === this.me, at: s.stageChangedAt };
  }

  /** "Stop" on a server job: deals not done yet are skipped (the server reports them). */
  cancelJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job) this.bulk.stop(job);
  }

  jobDone(job: Job) {
    return job.server ? job.server.finished : isJobDone(job);
  }

  // ---- select all: server bulk jobs (see bulkJobs.ts) ----------------------

  /** "Select all" + move: one request with the filter; the server runs it as a job. */
  moveMatching(filter: Query, target: Stage, shown: readonly MoveEntry[], label: string): Job | null {
    return this.bulk.start(filter, target, shown, label);
  }

  /** "Try again" on a job that couldn't be started. */
  restartJob(jobId: string) {
    this.bulk.restart(jobId);
  }

  /** The card side of a server job: what bulkJobs.ts may do to a card while the server works on it. */
  private jobHost(): JobHost {
    return {
      api: this.api,
      jobs: this.jobs,
      me: this.me,
      newKey,
      actor: () => this.actor(),
      canEdit: () => this.ensureCanEdit(),
      hold: (job, id, from, to) => {
        if (!this.server.has(id) || this.pending.has(id)) return; // my own unsaved change on it wins on screen
        this.pending.set(id, {
          origin: from, desired: to, req: null, status: 'saving', autoRetries: 0,
          inFlight: false, enqueued: false, timer: null, jobId: job.id, byServer: true,
        });
        this.mark(id);
      },
      release: (job, id) => {
        const p = this.pending.get(id);
        if (!p?.byServer || p.jobId !== job.id) return; // e.g. moved by hand meanwhile: that wins
        this.pending.delete(id);
        this.mark(id);
      },
      fail: (job, id, reason) => {
        const p = this.pending.get(id);
        if (!p?.byServer || p.jobId !== job.id) return;
        p.status = 'failed';
        p.error = reason;
        this.mark(id);
      },
      unfail: (job) => {
        for (const [id, o] of job.outcomes) {
          const p = this.pending.get(id);
          if (o !== 'failed' || !p?.byServer || p.jobId !== job.id) continue;
          p.status = 'saving';
          p.error = undefined;
          this.setOutcome(job.id, id, null);
          this.mark(id);
        }
      },
      stageShown: (id) => this.getView(id)?.deal.stage,
      applyServer: (deal) => void this.applyServer(deal),
      setOutcome: (jobId, id, o) => this.setOutcome(jobId, id, o),
      pushHistory: (entry) => this.history.push(entry),
      call: (fn, tries) => this.call(fn, tries),
      notify: () => this.notify(),
    };
  }

  /**
   * A small request (start, stop, status) with a few retries. Only used for calls that are safe to
   * repeat (they carry a key or don't change anything). Returns null if it never got through.
   */
  private async call<T>(fn: () => Promise<T>, tries = 3): Promise<T | null> {
    for (let i = 0; i < tries; i++) {
      try {
        const v = await fn();
        this.conn.succeeded();
        return v;
      } catch (e) {
        if (!(e instanceof NetworkError)) return null;
        this.conn.failed(e.offline);
        if (e.offline || i === tries - 1) return null;
        await sleep(this.backoffMs * 2 ** i);
      }
    }
    return null;
  }

  private actor(): Actor {
    return { user: this.me, session: this.session };
  }

  // ---- state machine -------------------------------------------------------

  private setStage(id: string, target: Stage, expected: Stage | undefined, jobId: string | undefined): 'noop' | 'queued' {
    const s = this.server.get(id);
    if (!s) return 'noop';
    let p = this.pending.get(id);
    if (!p) {
      if (target === s.stage) return 'noop'; // already there (maybe a teammate did it)
      p = {
        origin: expected ?? s.stage,
        desired: target,
        req: null,
        status: 'queued',
        autoRetries: 0,
        inFlight: false,
        enqueued: false,
        timer: null,
      };
      this.pending.set(id, p);
    } else {
      if (p.jobId && p.jobId !== jobId) this.setOutcome(p.jobId, id, 'skipped'); // superseded by a newer action
      if (p.jobId && p.jobId === jobId) this.setOutcome(jobId, id, null);
      if (p.status === 'conflict') {
        // The user has now seen the teammate's value and is acting on it.
        p.origin = s.stage;
      }
      if (p.status === 'failed') {
        p.autoRetries = 0;
        p.error = undefined;
      }
      p.status = 'queued';
      p.desired = target;
      p.byServer = false; // moved by hand: no longer the server job's to do (it skips changed deals)
    }
    p.jobId = jobId;
    this.mark(id);
    this.pump(id);
    return 'queued';
  }

  private pump(id: string) {
    const p = this.pending.get(id);
    if (!p || p.byServer) return;
    if (p.inFlight || p.enqueued || p.timer) return;
    if (p.status === 'failed' || p.status === 'conflict') return;
    if (!p.req) {
      if (p.desired === p.origin) return this.finish(id, p);
      p.req = { target: p.desired, key: newKey(), sends: 0 };
    }
    p.status = p.autoRetries > 0 ? 'retrying' : 'queued';
    this.queue(id, p);
  }

  private queue(id: string, p: Pending) {
    p.enqueued = true;
    this.ready.add(id);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private finish(id: string, p: Pending) {
    this.pending.delete(id);
    if (p.jobId) this.setOutcome(p.jobId, id, 'ok');
    this.mark(id);
  }

  /** Everything that became ready in this tick goes out together (a hand-picked move is one request). */
  private flush() {
    this.flushScheduled = false;
    const ids = Array.from(this.ready);
    this.ready.clear();
    for (let i = 0; i < ids.length; i += MAX_MOVE_ITEMS) this.batches.push(ids.slice(i, i + MAX_MOVE_ITEMS));
    this.drain();
  }

  /** Up to `concurrency` requests in flight, oldest first. */
  private drain() {
    if (!this.conn.canSend) return; // changes wait until we're back (or a reconnect check runs)
    while (this.active < this.concurrency && this.batches.length) {
      const batch = this.batches.shift()!;
      this.active++;
      void this.send(batch).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }

  private async send(ids: string[]) {
    const items: MoveItem[] = [];
    for (const id of ids) {
      const p = this.pending.get(id);
      if (!p || !p.enqueued || !p.req) continue; // no longer waiting (e.g. discarded)
      p.enqueued = false;
      if (p.req.sends === 0) {
        // Never sent yet: free to coalesce to the latest intent.
        if (p.desired === p.origin) {
          p.req = null;
          this.finish(id, p);
          continue;
        }
        p.req.target = p.desired;
      }
      p.req.sends++;
      p.inFlight = true;
      p.status = p.autoRetries > 0 ? 'retrying' : 'saving';
      items.push({ id, expected: p.origin, target: p.req.target, key: p.req.key });
      this.mark(id);
    }
    if (!items.length) return;
    try {
      const results = await this.api.move(items, this.actor());
      this.conn.succeeded(); // the server answered (even if some items were refused)
      for (const r of results) this.onResult(r);
    } catch (e) {
      const offline = e instanceof NetworkError && e.offline;
      const msg = e instanceof Error ? e.message : 'Unknown error';
      // Connection problems don't fail the user's changes: they wait and sync later.
      const hold = this.conn.failed(offline);
      for (const it of items) {
        const p = this.pending.get(it.id);
        if (!p || p.req?.key !== it.key) continue;
        p.inFlight = false;
        if (hold) {
          p.status = 'queued'; // keeps its request + key: resent as-is when we're back
          this.mark(it.id);
          this.pump(it.id);
        } else this.failOrRetry(it.id, p, msg);
      }
    }
  }

  private onResult(r: ItemResult) {
    if (r.status !== 'error') this.applyServer(r.deal);
    const p = this.pending.get(r.id);
    if (!p || p.req?.key !== r.key) return;
    p.inFlight = false;
    if (r.status === 'ok') {
      p.origin = p.req.target;
      p.req = null;
      p.autoRetries = 0;
      p.error = undefined;
      if (p.desired === p.origin) this.finish(r.id, p);
      else {
        p.status = 'queued';
        this.mark(r.id);
        this.pump(r.id);
      }
    } else if (r.status === 'conflict') {
      p.req = null;
      if (r.deal.stage === p.desired) {
        // Teammate already made the same change — nothing to resolve.
        p.origin = r.deal.stage;
        this.finish(r.id, p);
      } else {
        p.status = 'conflict';
        if (p.jobId) this.setOutcome(p.jobId, r.id, 'conflict');
        this.mark(r.id);
      }
    } else {
      this.failOrRetry(r.id, p, r.message);
    }
  }

  /** Transient failures retry quietly with backoff (same key); then surface to the user. */
  private failOrRetry(id: string, p: Pending, msg: string) {
    if (p.autoRetries < this.maxAutoRetries) {
      p.autoRetries++;
      p.status = 'retrying';
      p.error = msg;
      const delay = this.backoffMs * 2 ** (p.autoRetries - 1) * (0.75 + Math.random() * 0.5);
      p.timer = setTimeout(() => {
        p.timer = null;
        this.pump(id);
      }, delay);
    } else {
      p.status = 'failed';
      p.error = msg;
      if (p.jobId) this.setOutcome(p.jobId, id, 'failed');
    }
    this.mark(id);
  }

  private setOutcome(jobId: string, id: string, o: Outcome | null) {
    if (this.jobs.setOutcome(jobId, id, o)) this.notify();
  }
}

function describe(prev: Deal, next: Deal): string {
  if (prev.stage !== next.stage) return `moved to ${STAGE_LABEL[next.stage]}`;
  if (prev.owner !== next.owner) return `reassigned to ${next.owner}`;
  if (prev.value !== next.value) return 'changed the value';
  return 'logged activity';
}
