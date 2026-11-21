import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { STAGE_LABEL } from '@/entities/deal';
import type { Job, Outcome, PipelineClient } from '@/features/deals/api/pipelineClient';
import { useClientRev } from '@/features/deals/hooks/useClientRev';
import { fmtNum } from '@/shared/utils/format';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

type Filter = 'all' | Outcome | 'sending';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: 'Saved' },
  { id: 'failed', label: 'Not saved' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'sending', label: 'In progress' },
];
const ROW = 44;

/**
 * One bulk job, deal by deal: where each deal came from, where it went, and
 * what happened. Clicking a deal shows it on the board (even deep in a sorted
 * column of 10k), so after a bulk move you can always find what you moved.
 * Virtualised: a 50,000-deal job only draws the rows on screen.
 */
export function JobDetailsPanel(props: {
  client: PipelineClient;
  jobId: string | null;
  onClose(): void;
  /** Show a deal on the board (or its side panel if it's not in this view). */
  onShowDeal(id: string): void;
}) {
  const { client } = props;
  const rev = useClientRev(client);
  const job = props.jobId ? client.getJob(props.jobId) : undefined;
  const [filter, setFilter] = useState<Filter>('all');

  const outcomeOf = (j: Job, id: string): Filter => j.outcomes.get(id) ?? 'sending';
  const ids = useMemo(
    () => (!job ? [] : filter === 'all' ? job.ids : job.ids.filter((id) => outcomeOf(job, id) === filter)),
    [job, filter, rev],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, ok: 0, failed: 0, conflict: 0, skipped: 0, sending: 0 };
    if (job) for (const id of job.ids) { c.all++; c[outcomeOf(job, id)]++; }
    return c;
  }, [job, rev]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: ids.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 8 });

  return (
    <Sheet open={!!job} onOpenChange={(o) => !o && props.onClose()} modal={false}>
      {/* Can be opened from a toast that then disappears: losing focus that way must not close the panel. */}
      <SheetContent className="flex w-[480px] flex-col shadow-2xl sm:max-w-[480px]" onFocusOutside={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>{job?.label ?? 'Bulk move'}</SheetTitle>
          <SheetDescription>Every deal in this move and what happened to it. Click a deal to find it on the board.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap gap-1.5 px-4" role="tablist" aria-label="Filter by result">
          {FILTERS.filter((f) => f.id === 'all' || counts[f.id] > 0).map((f) => (
            <Button key={f.id} size="xs" role="tab" aria-selected={filter === f.id} variant={filter === f.id ? 'default' : 'outline'} onClick={() => setFilter(f.id)}>
              {f.label} {fmtNum(counts[f.id])}
            </Button>
          ))}
        </div>
        <div ref={scrollRef} className="mx-4 mb-4 min-h-0 flex-1 overflow-y-auto rounded-lg border text-sm">
          {ids.length === 0 ? (
            <p className="p-4 text-muted-foreground">No deals with this result.</p>
          ) : (
            <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const id = ids[vi.index];
                return (
                  <li key={id} className="absolute inset-x-0 border-b last:border-b-0" style={{ top: vi.start, height: ROW }}>
                    {job && <Row client={client} job={job} id={id} outcome={outcomeOf(job, id)} onShow={props.onShowDeal} />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row(props: { client: PipelineClient; job: Job; id: string; outcome: Filter; onShow(id: string): void }) {
  const { client, job, id, outcome } = props;
  const v = client.getView(id);
  if (!v) return null;
  const from = job.from.get(id);
  const conflict = v.status === 'conflict' && v.theirs;
  return (
    <div className="flex h-full items-center gap-2 px-3">
      <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => props.onShow(id)} title="Show on the board">
        {v.deal.name}
      </button>
      {from && <span className="shrink-0 text-xs text-muted-foreground">{STAGE_LABEL[from]} → {STAGE_LABEL[v.deal.stage]}</span>}
      {conflict ? (
        <>
          <span className="shrink-0 text-xs text-amber-700 dark:text-amber-300" title={`${v.theirs!.self ? 'You (other tab)' : v.theirs!.by} moved it to ${STAGE_LABEL[v.theirs!.stage]}`}>
            ⚠ {v.theirs!.self ? 'You' : v.theirs!.by}: {STAGE_LABEL[v.theirs!.stage]}
          </span>
          <Button size="xs" variant="ghost" onClick={() => client.keepTheirs(id)}>Theirs</Button>
          <Button size="xs" variant="outline" onClick={() => client.applyMine(id)}>Mine</Button>
        </>
      ) : outcome === 'failed' && v.status === 'failed' ? (
        <>
          <span className="shrink-0 text-xs text-destructive">✕ Not saved</span>
          <Button size="xs" variant="outline" onClick={() => client.retry(id)}>Retry</Button>
        </>
      ) : (
        <span className={cn('w-20 shrink-0 text-right text-xs', outcome === 'ok' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')} title={job.reasons.get(id)}>
          {outcome === 'ok' ? '✓ Saved' : outcome === 'skipped' ? 'Skipped' : outcome !== 'sending' ? 'Resolved'
            : v.status === 'retrying' ? 'Retrying…' : v.status === 'waiting' ? 'Waiting' : 'In progress…'}
        </span>
      )}
    </div>
  );
}
