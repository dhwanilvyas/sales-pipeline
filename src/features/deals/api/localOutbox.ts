import type { OutboxStore, StoredPending } from './pipelineClient';

/**
 * Where unsaved changes are kept, so they aren't lost. Nothing is ever re-sent
 * on its own: after a reload or a closed tab, the user is asked first.
 *
 *  - **Reload**: this tab's sessionStorage (synchronous, so the last state is
 *    written even as the page unloads). On start they're "parked" as a
 *    leftover, so the same question is asked as for a closed tab.
 *  - **Tab closed** (or crashed): a copy in IndexedDB, under this tab's id. On
 *    the next visit another tab finds it and asks.
 *
 * Which saved copies are abandoned? Each tab holds a Web Lock named after its
 * id for as long as it's open; the browser releases it when the tab closes or
 * crashes. So if tab B can take tab A's lock, tab A is gone and its changes are
 * left over; if it can't, tab A is still open (and still sending them), so tab
 * B leaves them alone. A tab that takes another tab's leftovers keeps that lock
 * too, so a third tab won't ask about the same changes.
 *
 * All best-effort: if storage or locks are unavailable, nothing breaks and the
 * browser's "Leave page?" warning still applies.
 */
export interface Leftover {
  tab: string;
  savedAt: number;
  entries: StoredPending[];
}

export interface LocalOutbox extends OutboxStore {
  /** Unsaved changes from before a reload or from closed tabs of this user. Claims them, so no other tab asks too. */
  leftovers(): Promise<Leftover[]>;
  /** Forget leftovers (after continuing or discarding them). */
  forget(tabs: string[]): Promise<void>;
  /** Drop everything, this tab's and leftovers (Reset demo data). */
  clear(): Promise<void>;
}

const SESSION_KEY = 'pipeline:outbox';
const TAB_KEY = 'pipeline:tab';
const DB_NAME = 'pipeline-client';
const STORE = 'outbox';
const lockName = (tab: string) => `pipeline-outbox:${tab}`;

interface Saved extends Leftover {
  user: string;
}

export function createLocalOutbox(user: string): LocalOutbox {
  // A reload keeps the tab id (sessionStorage); a duplicated tab inherits it too, but then the
  // original still holds the lock, so the copy takes a new id and leaves the original's changes alone.
  const ready = (async () => {
    const inherited = safeGet(TAB_KEY);
    // On a reload the old page releases its lock as it unloads, which can take a moment: wait briefly.
    if (inherited && (await holdLock(lockName(inherited), 2000))) return { tab: inherited, own: true };
    const tab = crypto.randomUUID();
    safe(() => sessionStorage.setItem(TAB_KEY, tab));
    await holdLock(lockName(tab));
    return { tab, own: !inherited };
  })();

  // This tab's changes from before a reload: park them as a leftover (a key nobody holds a lock
  // for), so they're offered like a closed tab's instead of being re-sent silently.
  const parked = ready.then(async ({ tab, own }) => {
    if (!own) return void safe(() => sessionStorage.removeItem(SESSION_KEY)); // a duplicated tab: not ours
    const fromSession = readSession();
    const fromDb = await withStore<Saved | undefined>('readonly', (s) => s.get(tab)).catch(() => undefined);
    const prev = fromSession?.user === user && fromSession.entries.length ? fromSession : fromDb?.user === user ? fromDb : null;
    if (prev?.entries.length) {
      const record: Saved = { tab: `reload-${crypto.randomUUID()}`, user, savedAt: prev.savedAt ?? Date.now(), entries: prev.entries };
      await withStore('readwrite', (s) => s.put(record)).catch(() => undefined);
    }
    safe(() => sessionStorage.removeItem(SESSION_KEY));
    await withStore('readwrite', (s) => s.delete(tab)).catch(() => undefined);
  }).catch(() => undefined);

  const writeDb = (entries: StoredPending[]) =>
    void parked.then(() => ready).then(({ tab }) =>
      withStore('readwrite', (s) => (entries.length ? s.put({ tab, user, savedAt: Date.now(), entries } satisfies Saved) : s.delete(tab))),
    ).catch(() => undefined);

  return {
    save(entries) {
      safe(() => (entries.length ? sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, savedAt: Date.now(), entries })) : sessionStorage.removeItem(SESSION_KEY)));
      writeDb(entries);
    },
    async leftovers() {
      await parked;
      const { tab: me } = await ready;
      const all = await withStore<Saved[]>('readonly', (s) => s.getAll()).catch(() => [] as Saved[]);
      const found: Leftover[] = [];
      for (const r of all) {
        if (r.tab === me || r.user !== user || !r.entries?.length) continue;
        if (await holdLock(lockName(r.tab))) found.push({ tab: r.tab, savedAt: r.savedAt, entries: r.entries });
      }
      return found;
    },
    async forget(tabs) {
      await Promise.all(tabs.map((t) => withStore('readwrite', (s) => s.delete(t)).catch(() => undefined)));
    },
    async clear() {
      safe(() => sessionStorage.removeItem(SESSION_KEY));
      await withStore('readwrite', (s) => s.clear()).catch(() => undefined);
    },
  };
}

/**
 * Take a lock and keep it until this tab closes. Resolves true if we got it, false if another tab
 * holds it. Without Web Locks support we can't tell, so we never treat other tabs' changes as left over.
 */
function holdLock(name: string, waitMs = 0): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(false);
  const opts: LockOptions = waitMs ? { signal: AbortSignal.timeout(waitMs) } : { ifAvailable: true };
  return new Promise((resolve) => {
    navigator.locks
      .request(name, opts, (lock) => {
        resolve(!!lock);
        return lock ? new Promise<void>(() => {}) : undefined; // never settles: held for the tab's lifetime
      })
      .catch(() => resolve(false));
  });
}

let db: Promise<IDBDatabase> | null = null;
function openDb() {
  return (db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'tab' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

async function withStore<T = unknown>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function readSession(): { user: string; savedAt?: number; entries: StoredPending[] } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    /* storage full or blocked: the outbox is best-effort; the leave-page warning still applies */
  }
}
