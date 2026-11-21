import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Toaster } from '@/shared/ui/sonner';

import { JobTray, JobsMenu, LeftoverChanges, ShortcutHelp, ConnectionBanner, useDealClient, useSyncNotifications } from '@/features/deals';
import { SimulatorPanel, useSimConfig } from '@/features/simulator';
import { useSession } from '@/app/providers/SessionProvider';
import { ShellContext, type ShellValue } from '@/shared/hooks/useShell';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { pageTitle } from './nav';

/**
 * Layout for every page: sidebar, top bar, and app-wide concerns that must keep
 * working whichever page is open (save failures, conflicts, bulk jobs,
 * reconnecting, the simulator).
 */
export function AppShell() {
  const { sim, user, loaded, outbox } = useSession();
  const client = useDealClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [jobDetailsId, setJobDetailsId] = useState<string | null>(null);
  /** Toasts stack just above the job tray (both bottom-right). */
  const [trayHeight, setTrayHeight] = useState(0);
  const onTrayHeight = useCallback((px: number) => setTrayHeight(px), []);
  /** The tray can be minimised to a pill; a new job opens it again. */
  const [trayCollapsed, setTrayCollapsed] = useState(false);
  const jobs = client.getJobs();
  const newestJob = jobs[0]?.id;
  useEffect(() => setTrayCollapsed(false), [newestJob]);
  const showJob = (id: string) => { client.reopenJob(id); setTrayCollapsed(false); };
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  /** The Unsaved changes panel lives on the Deals page; go there first if needed. */
  const reviewIssues = () => {
    if (location.pathname !== '/deals') navigate({ pathname: '/deals', search: location.search });
    setReviewOpen(true);
  };
  /** Same for a job's details panel. */
  const openJobDetails = (id: string) => {
    if (location.pathname !== '/deals') navigate({ pathname: '/deals', search: location.search });
    setReviewOpen(false);
    setJobDetailsId(id);
  };
  // Toasts about failed/conflicting saves and reconnecting (re-renders on client changes).
  const summary = useSyncNotifications(client, reviewIssues);

  // Online = the browser has a network AND (with the fake backend) the simulator's switch is on.
  const simOnline = useSimConfig(sim)?.online ?? true;
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => client.setOnline(simOnline && browserOnline), [client, simOnline, browserOnline]);

  const shell = useMemo<ShellValue>(() => ({
    openHelp: () => setHelpOpen(true),
    openSim: () => sim && setSimOpen(true),
    overlayOpen: helpOpen || simOpen,
    reviewOpen,
    openReview: () => setReviewOpen(true),
    closeReview: () => setReviewOpen(false),
    jobDetailsId,
    openJobDetails: (id: string) => { setReviewOpen(false); setJobDetailsId(id); },
    closeJobDetails: () => setJobDetailsId(null),
    titleSlot,
  }), [helpOpen, simOpen, sim, reviewOpen, jobDetailsId, titleSlot]);

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-dvh bg-background text-foreground">
        <Sidebar user={user} connection={client.connection} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            title={pageTitle(location.pathname)}
            titleSlotRef={setTitleSlot}
            shared={sim?.shared ?? true}
            summary={summary}
            onRetryAll={() => client.retryAll()}
            onReview={reviewIssues}
            onHelp={() => setHelpOpen(true)}
            jobs={<JobsMenu client={client} now={Date.now()} onShow={showJob} onDetails={openJobDetails} />}
            onSim={sim ? () => setSimOpen(true) : undefined}
          />
          <ConnectionBanner
            connection={client.connection}
            offlineSince={client.offlineSince}
            nextProbeAt={client.nextProbeAt}
            checking={client.checkingConnection}
            waiting={summary.waiting}
            onRetryNow={() => client.retryNow()}
          />
          {loaded ? <Outlet /> : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading deals…</div>
          )}
        </div>
      </div>
      <JobTray client={client} jobs={jobs} collapsed={trayCollapsed} onCollapse={setTrayCollapsed} onReview={reviewIssues} onDetails={openJobDetails} onHeight={onTrayHeight} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <LeftoverChanges client={client} outbox={outbox} loaded={loaded} now={Date.now()} />
      {sim && (
        <SimulatorPanel
          open={simOpen}
          onClose={() => setSimOpen(false)}
          backend={sim}
          me={user}
        />
      )}
      {/* Every notification goes away after 5s (paused while hovered); conflicts and failures also stay in the header. */}
      <Toaster position="bottom-right" closeButton duration={5000} offset={{ right: 24, bottom: trayHeight ? 24 + trayHeight + 8 : 24 }} />
    </ShellContext.Provider>
  );
}
