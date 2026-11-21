import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { PipelineClient, RemoteChange } from '@/features/deals/api/pipelineClient';
import { changeText } from '@/features/deals/utils/changeText';
import { plural } from '@/shared/utils/format';

/**
 * Someone changed one of MY deals: say who did what, once per action.
 *   "Rahul moved Acme to Won · View"
 *   "Riya moved 40 of your deals to Lost · View"
 *   "While you were offline: Riya moved 40… · Rahul moved Acme… · View"
 * On views of my own deals the board has already updated, so the toast just
 * explains it. On All deals the board waits, so the toast also offers Apply (`.`).
 * View opens exactly what changed (ChangeDetailsPanel).
 * Any change to my deals gets one (stage, owner, value…). Actions arriving
 * close together become one toast.
 */
export function useTeammateToasts(
  client: PipelineClient, rev: number, live: boolean, onApply: () => void,
  onView: (changes: { title: string; items: RemoteChange[] }) => void,
) {
  const seen = useRef<RemoteChange | undefined>(client.recentActivity()[0]);
  const batch = useRef<{ items: RemoteChange[]; timer: ReturnType<typeof setTimeout> | null }>({ items: [], timer: null });
  const actions = useRef({ onApply, onView, live });
  const lastId = useRef<string | null>(null);
  const seq = useRef(0);
  actions.current = { onApply, onView, live };
  useEffect(() => () => { if (batch.current.timer) clearTimeout(batch.current.timer); }, []);

  useEffect(() => {
    const all = client.recentActivity();
    const fresh: RemoteChange[] = [];
    for (const a of all) {
      if (a === seen.current) break;
      fresh.push(a);
    }
    seen.current = all[0];
    const b = batch.current;
    // Not for a deal I'm saving right now: if it clashes, the conflict notice says it (with Review).
    b.items.push(...fresh.filter((a) => !a.self && a.forMe > 0 && !(a.count === 1 && client.getView(a.id)?.status)));
    if (!b.items.length || b.timer) return;
    b.timer = setTimeout(() => {
      const items = b.items.reverse(); // oldest first
      b.items = [];
      b.timer = null;
      // Live views have already applied it; elsewhere the board waits for Apply.
      const apply = actions.current.live ? {} : { action: { label: 'Apply (.)', onClick: () => actions.current.onApply() } };
      // Every notification about my deals can be opened to see exactly what changed.
      const view = (title: string, list: RemoteChange[]) => ({ cancel: { label: 'View', onClick: () => actions.current.onView({ title, items: list }) } });
      const line = (a: RemoteChange) => `${a.by} ${changeText(a.what, a.count === 1 ? a.name : plural(a.forMe, 'of your deals', 'of your deals'))}`;
      const missed = items.filter((a) => a.offline);
      if (missed.length) {
        // Its own toast, so live changes arriving right after reconnecting don't push it away.
        toast('While you were offline', {
          id: 'teammate-offline',
          description: missed.slice(0, 3).map(line).join(' · ') + (missed.length > 3 ? ` · and ${missed.length - 3} more` : ''),
          ...apply,
          ...view('While you were offline', missed),
        });
        items.splice(0, items.length, ...items.filter((a) => !a.offline));
        if (!items.length) return;
      }
      // Replace the previous toast with a new one (reusing its id would keep its old buttons).
      if (lastId.current) toast.dismiss(lastId.current);
      const id = (lastId.current = `teammate-${++seq.current}`);
      if (items.length === 1) {
        const a = items[0];
        toast(line(a), { id, ...apply, ...view(line(a), [a]) });
        return;
      }
      const title = `${plural(items.length, 'change')} to your deals`;
      toast(title, {
        id,
        description: items.slice(0, 3).map(line).join(' · ') + (items.length > 3 ? ` · and ${items.length - 3} more` : ''),
        ...apply,
        ...view(title, items),
      });
    }, 600);
  }, [client, rev]);
}
