import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STAGE_LABEL, type Stage } from '@/entities/deal';
import type { ConflictGroup, PipelineClient } from '@/features/deals/api/pipelineClient';
import { useClientRev } from '@/features/deals/hooks/useClientRev';
import { StageBadge } from './StageBadge';
import { fmtAgo, fmtNum, plural } from '@/shared/utils/format';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

/**
 * Everything of mine that isn't saved, in one side panel, with the board left
 * as it is behind it: conflicts grouped by who did what ("Rahul moved 9 deals
 * to Lost"), each expandable to its deals, and failed saves with Retry/Discard.
 */
export function UnsavedPanel(props: {
  client: PipelineClient;
  open: boolean;
  now: number;
  onClose(): void;
  onResolveGroup(ids: string[], choice: 'theirs' | 'mine'): void;
  /** Show a deal on the board (closes the panel). */
  onShowDeal(id: string): void;
}) {
  const { client } = props;
  useClientRev(client); // re-render as conflicts get resolved or saves go through
  const groups = props.open ? client.conflictGroups() : [];
  const failed = props.open ? client.failedIds() : [];
  const conflicts = groups.reduce((n, g) => n + g.ids.length, 0);

  return (
    // Non-modal, like the deal panel: the board stays visible and sharp beside it.
    <Sheet open={props.open} onOpenChange={(o) => !o && props.onClose()} modal={false}>
      {/* Can be opened from a toast that then disappears: losing focus that way must not close the panel. */}
      <SheetContent className="w-[460px] overflow-y-auto shadow-2xl sm:max-w-[460px]" onFocusOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>Unsaved changes</SheetTitle>
          <SheetDescription>
            {conflicts + failed.length === 0
              ? 'All your changes are saved.'
              : 'Nothing was overwritten. Decide per group, or open a group to decide per deal.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
          {groups.length > 0 && (
            <section aria-label="Conflicts">
              <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Conflicts ({fmtNum(conflicts)})</h3>
              <ul className="flex flex-col gap-2">
                {groups.map((g) => <Group key={g.key} group={g} {...props} />)}
              </ul>
            </section>
          )}

          {failed.length > 0 && (
            <section aria-label="Not saved">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Not saved ({fmtNum(failed.length)})</h3>
                <Button size="xs" variant="outline" onClick={() => client.retryAll()}>Retry all</Button>
              </div>
              <ul className="divide-y rounded-lg border">
                {failed.map((id) => {
                  const v = client.getView(id);
                  if (!v) return null;
                  return (
                    <li key={id} className="flex items-center gap-2 px-3 py-2">
                      <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => props.onShowDeal(id)}>
                        {v.deal.name}
                      </button>
                      <span className="shrink-0 text-xs text-muted-foreground">→ {STAGE_LABEL[v.deal.stage]}</span>
                      <Button size="xs" variant="outline" onClick={() => client.retry(id)}>Retry</Button>
                      <Button size="xs" variant="ghost" onClick={() => client.discard(id)}>Discard</Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One "who moved N deals where" group: decide for all of them, or open it to decide per deal. */
function Group(props: { group: ConflictGroup; client: PipelineClient; now: number; onResolveGroup(ids: string[], c: 'theirs' | 'mine'): void; onShowDeal(id: string): void }) {
  const { group: g, client } = props;
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="rounded-lg border border-amber-300 bg-amber-50/60 dark:bg-amber-950/30">
      <div className="flex flex-col gap-2 px-3 py-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-left">
          <Chevron className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{g.self ? 'You (another tab)' : g.by}</span>
          <span>moved {plural(g.ids.length, 'deal')} to</span>
          <StageBadge stage={g.stage} />
          <span className="text-muted-foreground">· you wanted {wantedText(g.wanted)} · {fmtAgo(g.latestAt, props.now)}</span>
        </button>
        <div className="flex gap-1.5 pl-5">
          <Button size="xs" variant="outline" onClick={() => props.onResolveGroup(g.ids, 'theirs')}>Keep {STAGE_LABEL[g.stage]}</Button>
          <Button size="xs" variant="outline" onClick={() => props.onResolveGroup(g.ids, 'mine')}>Apply mine</Button>
        </div>
      </div>
      {open && (
        <ul className="divide-y divide-amber-200 border-t border-amber-200 dark:divide-amber-900 dark:border-amber-900">
          {g.ids.map((id) => {
            const v = client.getView(id);
            if (!v?.theirs) return null;
            return (
              <li key={id} className="flex items-center gap-2 px-3 py-1.5 pl-8">
                <div className="min-w-0 flex-1">
                  <button type="button" className="block max-w-full truncate text-left font-medium hover:underline" onClick={() => props.onShowDeal(id)}>{v.deal.name}</button>
                  <div className="text-xs text-muted-foreground">
                    You: {STAGE_LABEL[v.deal.stage]} · {v.theirs.self ? 'You (another tab)' : v.theirs.by}: {STAGE_LABEL[v.theirs.stage]}
                  </div>
                </div>
                <Button size="xs" variant="ghost" onClick={() => client.keepTheirs(id)}>Keep theirs</Button>
                <Button size="xs" variant="ghost" onClick={() => client.applyMine(id)}>Apply mine</Button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function wantedText(wanted: Partial<Record<Stage, number>>): string {
  const entries = Object.entries(wanted) as [Stage, number][];
  if (entries.length === 1) return STAGE_LABEL[entries[0][0]];
  return entries.sort((a, b) => b[1] - a[1]).map(([s, n]) => `${STAGE_LABEL[s]} (${fmtNum(n)})`).join(', ');
}
