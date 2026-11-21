import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Api } from '@/entities/deal';
import type { Simulator } from '@mock-server/types';
import { PipelineClient, DealClientProvider, createLocalOutbox, type LocalOutbox } from '@/features/deals';

/**
 * Creates the tab's one sync client (above the router, so pending saves and
 * bulk jobs survive page changes) and hands it to the deals feature through
 * DealClientProvider. Its own context only holds app-level things: the
 * simulator, who is signed in, and whether the deals have loaded.
 */
interface SessionValue {
  /** Controls for the fake backend; null with a real API. */
  sim: Simulator | null;
  /**
   * Who is signed in. There's no real login: it's fixed for the tab's lifetime
   * (Priya, or ?user=Rahul to open a second window as a teammate).
   */
  user: string;
  loaded: boolean;
  /** Where unsaved changes are kept (reload, and left over from closed tabs). */
  outbox: LocalOutbox;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider(props: { api: Api; sim?: Simulator; session: string; user: string; children: ReactNode }) {
  const { api, session } = props;
  const sim = props.sim ?? null;
  const { user } = props;
  const [outbox] = useState(() => createLocalOutbox(user));
  const [client] = useState(() => new PipelineClient(api, { me: user, session, outbox }));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    sim?.registerSession({ user, session }); // lets simulated teammates edit deals of people who are online
    void client.load().then(() => setLoaded(true));
    const bye = () => {
      client.flushOutbox(); // unsynced changes survive a reload
      sim?.unregisterSession(session);
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, [sim, client, session, user, outbox]);

  // "Reset demo data" (from any tab): drop local changes and start over with the fresh data.
  useEffect(() => sim?.onReset(() => {
    client.discardAll();
    void outbox.clear().finally(() => window.location.reload());
  }), [sim, client, outbox]);

  // Unsynced changes survive a reload, and closing the tab (offered again on the next visit), but the browser
  // still asks "Leave page?": leaving means they wait until you come back, and they may conflict by then.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      client.flushOutbox();
      const s = client.summary();
      if (s.saving + s.waiting + s.failed + s.conflicts > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [client]);

  const value = useMemo<SessionValue>(() => ({ sim, user, loaded, outbox }), [sim, user, loaded, outbox]);

  return (
    <SessionContext.Provider value={value}>
      <DealClientProvider client={client}>{props.children}</DealClientProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
