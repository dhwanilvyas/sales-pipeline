import { STAGE_LABEL, type Stage } from '@/entities/deal';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { plural } from '@/shared/utils/format';
import { useStableCallbacks } from '@/shared/hooks/useStableCallbacks';
import type { PipelineClient } from '@/features/deals/api/pipelineClient';
import { useClientRev } from './useClientRev';

/**
 * Never fail silently: app-wide toasts about the user's changes, whatever page
 * is open. When saves fail or clash, and when the connection comes back.
 */
export function useSyncNotifications(client: PipelineClient, onReview: () => void) {
  useClientRev(client); // re-run on every client change
  const summary = client.summary();
  const { review } = useStableCallbacks({ review: onReview });

  // A new change was refused because we can't reach the server: say why, and what happens to earlier ones.
  useEffect(() => client.onBlocked(() => {
    const waiting = client.summary().waiting;
    toast.warning(client.connection === 'offline' ? "You're offline: changes are paused" : "Can't reach the server: changes are paused", {
      id: 'changes-paused',
      description: waiting
        ? `You can keep browsing. ${plural(waiting, 'change')} you already made will be sent when you're back.`
        : "You can keep browsing; make changes again once you're back (the board may be out of date until then).",
    });
  }), [client]);

  // Conflicts from a single move are toasted at once. A bulk job's conflicts are counted live in the
  // job tray and reviewed together when the job ends (the Unsaved changes panel opens by itself).
  const prev = useRef({ failed: 0, conflicts: 0 });
  useEffect(() => {
    const { failed } = summary;
    const conflicts = summary.conflicts - summary.jobConflicts;
    if (failed > prev.current.failed) {
      toast.error(`${plural(failed, 'change')} not saved`, {
        id: 'failures',
        description: 'We retried a few times. The deals are marked; retry or discard them.',
        action: { label: 'Retry all', onClick: () => client.retryAll() },
      });
    }
    if (conflicts > prev.current.conflicts) {
      // Say who and what when we can: "Varun moved Acme to Contacted · you wanted Negotiation".
      const groups = client.conflictGroups();
      const one = groups.length === 1 && groups[0].ids.length === 1 ? groups[0] : null;
      const name = one ? client.getView(one.ids[0])?.deal.name : undefined;
      const wanted = one ? (Object.keys(one.wanted)[0] as Stage | undefined) : undefined;
      const title = one && name
        ? `${one.self ? 'You (other tab)' : one.by} moved ${name} to ${STAGE_LABEL[one.stage]}${wanted ? ` · you wanted ${STAGE_LABEL[wanted]}` : ''}`
        : `${plural(conflicts, 'conflict')}: someone else changed deals you were moving`;
      toast.warning(title, {
        id: 'conflicts',
        description: 'Nothing was overwritten. Choose whose change to keep.',
        action: { label: 'Review', onClick: review },
      });
    }
    prev.current = { failed, conflicts };
  });

  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const job of client.getJobs()) {
      if (!client.jobDone(job)) running.current.add(job.id);
      else if (running.current.delete(job.id) && client.openConflicts(job) > 0) review();
    }
  });

  const lastConnection = useRef(client.connection);
  useEffect(() => {
    const was = lastConnection.current;
    lastConnection.current = client.connection;
    if (was !== 'online' && client.connection === 'online') {
      const n = summary.saving + summary.waiting;
      toast.success(was === 'offline' ? "You're back online" : 'Connected to the server again', {
        id: 'online',
        description: n ? `Syncing ${plural(n, 'change')}. Conflicts, if any, will be shown on the deals.` : 'Catching up on changes made while you were away.',
      });
    }
  });


  return summary;
}
