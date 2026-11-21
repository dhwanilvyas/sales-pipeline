import { generateDeals } from './seed';
import { FakeServer } from './fakeServer';
import type { CallMethod, ToClient, ToServer } from './protocol';
import { DEFAULT_CONFIG, type Backend, type SimConfig, type Simulator } from './types';
import {
  NetworkError, type Actor, type Api, type BulkChange, type BulkJob, type BulkUpdate, type Deal, type ItemResult, type MoveItem, type Query, type Stage,
} from '@/entities/deal';

/** Talks to the shared server in a SharedWorker via postMessage RPC. */
class WorkerBackend implements Backend {
  readonly shared = true;
  private port: MessagePort;
  private seq = 0;
  private calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private pushListeners = new Set<(d: Deal) => void>();
  private jobListeners = new Set<(u: BulkUpdate) => void>();
  private bulkChangeListeners = new Set<(c: BulkChange) => void>();
  private configListeners = new Set<(c: SimConfig) => void>();
  private resetListeners = new Set<() => void>();
  private config: SimConfig = DEFAULT_CONFIG;

  constructor() {
    const worker = new SharedWorker(new URL('./server.worker.ts', import.meta.url), { type: 'module', name: 'pipeline-server' });
    this.port = worker.port;
    this.port.onmessage = (e: MessageEvent<ToClient>) => this.onMessage(e.data);
    this.port.start();
  }

  private post(m: ToServer) {
    this.port.postMessage(m);
  }

  private onMessage(m: ToClient) {
    if (m.t === 'push') this.pushListeners.forEach((l) => l(m.deal));
    else if (m.t === 'job') this.jobListeners.forEach((l) => l(m.update));
    else if (m.t === 'bulkChange') this.bulkChangeListeners.forEach((l) => l(m.change));
    else if (m.t === 'reset') this.resetListeners.forEach((l) => l());
    else if (m.t === 'config') {
      this.config = m.config;
      this.configListeners.forEach((l) => l(m.config));
    } else {
      const call = this.calls.get(m.id);
      if (!call) return;
      this.calls.delete(m.id);
      if (m.ok) call.resolve(m.value);
      else call.reject(m.error.network ? new NetworkError(m.error.message, m.error.offline) : new Error(m.error.message));
    }
  }

  private call<T>(method: CallMethod, args: unknown[] = []): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.calls.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ t: 'call', id, method, args });
    });
  }

  listDeals() { return this.call<Deal[]>('listDeals'); }
  move(items: MoveItem[], actor: Actor) { return this.call<ItemResult[]>('move', [items, actor]); }
  changesSince(seq: number) { return this.call<Deal[]>('changesSince', [seq]); }
  startBulkMove(req: { key: string; label: string; filter: Query; target: Stage }, actor: Actor) { return this.call<BulkJob>('startBulkMove', [req, actor]); }
  cancelBulk(jobId: string) { return this.call<void>('cancelBulk', [jobId]); }
  retryBulkFailed(jobId: string) { return this.call<BulkJob>('retryBulkFailed', [jobId]); }
  undoBulk(jobId: string, key: string, actor: Actor) { return this.call<BulkJob>('undoBulk', [jobId, key, actor]); }
  bulkJobs(user: string) { return this.call<BulkJob[]>('bulkJobs', [user]); }
  onBulkChange(l: (c: BulkChange) => void) { this.bulkChangeListeners.add(l); return () => void this.bulkChangeListeners.delete(l); }
  onBulkUpdate(l: (u: BulkUpdate) => void) { this.jobListeners.add(l); return () => void this.jobListeners.delete(l); }
  onPush(l: (d: Deal) => void) { this.pushListeners.add(l); return () => void this.pushListeners.delete(l); }
  getConfig() { return this.config; }
  setConfig(patch: Partial<SimConfig>) { this.post({ t: 'setConfig', patch }); }
  onConfig(l: (c: SimConfig) => void) { this.configListeners.add(l); return () => void this.configListeners.delete(l); }
  registerSession(actor: Actor) { this.post({ t: 'register', actor }); }
  unregisterSession(session: string) { this.post({ t: 'bye', session }); }
  resetDemoData() { this.post({ t: 'reset' }); }
  onReset(l: () => void) { this.resetListeners.add(l); return () => void this.resetListeners.delete(l); }
}

/** Fallback when SharedWorker isn't available: a private, in-memory server in this tab (nothing persisted). */
class LocalBackend extends FakeServer implements Backend {
  readonly shared = false;
  private resetListeners = new Set<() => void>();
  constructor() {
    super(generateDeals(50_000, Date.now()));
    this.startTeammates();
  }
  resetDemoData() { this.resetListeners.forEach((l) => l()); }
  onReset(l: () => void) { this.resetListeners.add(l); return () => void this.resetListeners.delete(l); }
}

/**
 * The fake backend, as two handles: `api` is all the app's sync engine uses (a
 * real backend would provide just this); `sim` drives the Simulator panel.
 */
export function createBackend(): { api: Api; sim: Simulator } {
  const backend = sharedOrLocal();
  return { api: backend, sim: backend };
}

function sharedOrLocal(): Backend {
  if (typeof SharedWorker !== 'undefined') {
    try {
      return new WorkerBackend();
    } catch {
      /* fall through */
    }
  }
  return new LocalBackend();
}
