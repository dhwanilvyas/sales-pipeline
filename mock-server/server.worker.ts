/**
 * SharedWorker: ONE fake backend shared by every open tab, so two windows
 * (e.g. Priya and Rahul) really edit the same data concurrently. Changes are
 * kept in IndexedDB, so they survive reloads and closing every tab.
 */
import { generateDeals } from './seed';
import { FakeServer } from './fakeServer';
import { applyStored, openServerStorage, type ServerStorage } from './storage';
import type { ToClient, ToServer } from './protocol';
import { NetworkError, type Actor, type MoveItem } from '@/entities/deal';

const DEAL_COUNT = 50_000;
const ports = new Set<MessagePort>();
let storage: ServerStorage | null = null;
let server: Promise<FakeServer> = boot();

async function boot(fresh = false): Promise<FakeServer> {
  storage ??= await openServerStorage();
  const saved = fresh ? null : await storage?.load().catch(() => null);
  const createdAt = saved?.createdAt ?? Date.now();
  if (!saved) await storage?.start(createdAt).catch(() => undefined);
  const { deals, seq } = applyStored(generateDeals(DEAL_COUNT, createdAt), saved?.changed ?? []);
  const s = new FakeServer(deals, { seq });
  if (storage) {
    const store = storage;
    s.onWrite((deal) => store.save(deal));
  }
  s.startTeammates();
  return s;
}

async function reset() {
  const old = await server;
  old.stopTeammates();
  await storage?.clear().catch(() => undefined);
  server = boot(true);
  await server;
  for (const port of ports) port.postMessage({ t: 'reset' } satisfies ToClient);
}

const scope = self as unknown as { onconnect: ((e: MessageEvent) => void) | null };

scope.onconnect = (e: MessageEvent) => {
  const port = e.ports[0];
  ports.add(port);
  const send = (m: ToClient) => port.postMessage(m);
  const subscribed = server.then((s) => {
    const unsubPush = s.onPush((deal) => send({ t: 'push', deal }));
    const unsubJobs = s.onBulkUpdate((update) => send({ t: 'job', update }));
    const unsubBulk = s.onBulkChange((change) => send({ t: 'bulkChange', change }));
    const unsubConfig = s.onConfig((config) => send({ t: 'config', config }));
    send({ t: 'config', config: s.getConfig() });
    return () => { unsubPush(); unsubJobs(); unsubBulk(); unsubConfig(); };
  });

  port.onmessage = async (ev: MessageEvent<ToServer>) => {
    const m = ev.data;
    if (m.t === 'reset') return void reset();
    const s = await server; // requests that arrive while starting up simply wait
    switch (m.t) {
      case 'call':
        try {
          let value: unknown;
          if (m.method === 'listDeals') value = await s.listDeals();
          else if (m.method === 'move') {
            // Like a real database: the change is on disk before the save is confirmed, so a reload right
            // after "saved" can't lose it. (Also when the reply is then "lost": the write did happen.)
            try {
              value = await s.move(m.args[0] as MoveItem[], m.args[1] as Actor);
            } finally {
              await storage?.flush().catch(() => undefined);
            }
          }
          else {
            // The other calls map 1:1 onto the server's methods (bulk job writes are saved as they happen).
            const fn = s[m.method] as (...a: unknown[]) => Promise<unknown>;
            value = await fn.apply(s, m.args);
          }
          send({ t: 'res', id: m.id, ok: true, value });
        } catch (err) {
          const network = err instanceof NetworkError;
          send({
            t: 'res', id: m.id, ok: false,
            error: { message: err instanceof Error ? err.message : String(err), network, offline: network && err.offline },
          });
        }
        break;
      case 'setConfig':
        s.setConfig(m.patch);
        break;
      case 'register':
        s.registerSession(m.actor);
        break;
      case 'bye':
        s.unregisterSession(m.session);
        (await subscribed)();
        ports.delete(port);
        port.close();
        break;
    }
  };
  port.start();
};
