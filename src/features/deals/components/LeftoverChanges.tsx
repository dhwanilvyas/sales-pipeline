import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { STAGES, STAGE_LABEL, type Stage } from '@/entities/deal';
import type { PipelineClient, StoredPending } from '@/features/deals/api/pipelineClient';
import type { LocalOutbox } from '@/features/deals/api/localOutbox';
import { fmtAgo, fmtNum, plural } from '@/shared/utils/format';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';

interface Found {
  tabs: string[];
  savedAt: number;
  entries: StoredPending[];
  changedSince: number;
}

/**
 * "380 unsaved changes": changes not sent before the page was reloaded or a
 * tab was closed. Nothing is re-sent until the user says so. Checked against
 * the latest data first (already-done ones are dropped), then the user
 * decides: Continue (runs them as a job, so progress and Details work as
 * usual), Discard, or Not now (asked again on the next load).
 */
export function LeftoverChanges(props: { client: PipelineClient; outbox: LocalOutbox; loaded: boolean; now: number }) {
  const { client, outbox, loaded } = props;
  const [found, setFound] = useState<Found | null>(null);

  useEffect(() => {
    if (!loaded) return;
    let live = true;
    void outbox.leftovers().then((list) => {
      if (!live || !list.length) return;
      const tabs = list.map((l) => l.tab);
      const { entries, changedSince } = client.checkLeftovers(list.flatMap((l) => l.entries));
      if (!entries.length) return void outbox.forget(tabs); // all done meanwhile: nothing to ask
      setFound({ tabs, savedAt: Math.max(...list.map((l) => l.savedAt)), entries, changedSince });
    });
    return () => { live = false; };
  }, [loaded, client, outbox]);

  if (!found) return null;
  const byStage = new Map<Stage, number>();
  for (const e of found.entries) byStage.set(e.desired, (byStage.get(e.desired) ?? 0) + 1);

  const finish = () => { void outbox.forget(found.tabs); setFound(null); };
  const proceed = () => {
    if (!client.ensureCanEdit()) return; // offline: keep them (and this dialog) until we're back
    const n = client.continueLeftovers(found.entries);
    finish();
    toast.success(`Continuing ${plural(n, 'change')}`, { description: n > 1 ? 'Progress and details are in the tray.' : undefined });
  };
  const discard = () => {
    finish();
    toast(`Discarded ${plural(found.entries.length, 'unsaved change')}`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && setFound(null) /* Not now: ask again next visit */}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{plural(found.entries.length, 'unsaved change')}</DialogTitle>
          <DialogDescription>
            These weren't sent before the page was reloaded or closed ({fmtAgo(found.savedAt, props.now)}). Nothing has been applied yet.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          {STAGES.filter((s) => byStage.has(s)).map((s) => (
            <li key={s} className="flex justify-between">
              <span>Move to {STAGE_LABEL[s]}</span>
              <span className="tabular-nums">{fmtNum(byStage.get(s)!)}</span>
            </li>
          ))}
        </ul>
        {found.changedSince > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {plural(found.changedSince, 'deal')} {found.changedSince === 1 ? 'was' : 'were'} changed by someone since. Nothing is overwritten: you'll decide those as conflicts.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setFound(null)}>Not now</Button>
          <Button variant="outline" onClick={discard}>Discard</Button>
          <Button onClick={proceed} autoFocus>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
