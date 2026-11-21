import type { Deal } from '@/entities/deal';

/**
 * The fake server's "database" on disk (IndexedDB, which works inside a
 * SharedWorker). Only deals that changed are stored: on start the server
 * regenerates the same base data (fixed seed + the original creation time)
 * and applies the stored changes on top. So moves survive reloads and closing
 * every tab, until "Reset demo data".
 */
const DB_NAME = 'pipeline-fake-server';
const DEALS = 'deals';
const META = 'meta';

export interface StoredState {
  /** When the base data was generated (dates in it are relative to this). */
  createdAt: number;
  changed: Deal[];
}

export interface ServerStorage {
  load(): Promise<StoredState | null>;
  start(createdAt: number): Promise<void>;
  /** Queued and written in batches (a few hundred ms later), or right away by `flush`. */
  save(deal: Deal): void;
  /** Write everything queued now; resolves once it's on disk. */
  flush(): Promise<void>;
  clear(): Promise<void>;
}

/** Base data + stored changes → the deals to serve, and the server's change counter. */
export function applyStored(base: Deal[], changed: Deal[]): { deals: Deal[]; seq: number } {
  if (!changed.length) return { deals: base, seq: 0 };
  const byId = new Map(changed.map((d) => [d.id, d]));
  let seq = 0;
  for (const d of changed) seq = Math.max(seq, d.seq);
  return { deals: base.map((d) => byId.get(d.id) ?? d), seq };
}

const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Returns null when IndexedDB is unavailable (e.g. some private modes): the server then runs in memory only. */
export async function openServerStorage(): Promise<ServerStorage | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase;
  try {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore(DEALS, { keyPath: 'id' });
      open.result.createObjectStore(META);
    };
    db = await request(open);
  } catch {
    return null;
  }

  const queue = new Map<string, Deal>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.size) return Promise.resolve();
    const tx = db.transaction(DEALS, 'readwrite');
    const store = tx.objectStore(DEALS);
    for (const d of queue.values()) store.put(d);
    queue.clear();
    return done(tx);
  };

  return {
    async load() {
      const tx = db.transaction([DEALS, META], 'readonly');
      const createdAt = await request(tx.objectStore(META).get('createdAt') as IDBRequest<number | undefined>);
      if (createdAt === undefined) return null;
      const changed = await request(tx.objectStore(DEALS).getAll() as IDBRequest<Deal[]>);
      return { createdAt, changed };
    },
    async start(createdAt) {
      const tx = db.transaction(META, 'readwrite');
      tx.objectStore(META).put(createdAt, 'createdAt');
      await done(tx);
    },
    save(deal) {
      queue.set(deal.id, deal);
      timer ??= setTimeout(() => void flush(), 300);
    },
    flush,
    async clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      queue.clear();
      const tx = db.transaction([DEALS, META], 'readwrite');
      tx.objectStore(DEALS).clear();
      tx.objectStore(META).clear();
      await done(tx);
    },
  };
}
