import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Kbd } from '@/shared/ui/kbd';
import { Progress } from '@/shared/ui/progress';
import { fmtNum } from '@/shared/utils/format';
import { type Job, type PipelineClient } from '@/features/deals/api/pipelineClient';
import { jobStatus } from '@/features/deals/utils/jobStatus';

/**
 * Bulk jobs belong to the app (they keep running if you change page), so the tray lives in the shell.
 * It sits bottom-right with the toasts; `onHeight` lets the shell stack the toasts just above it.
 * It can be minimised to a small pill (the job keeps running); closing a finished job keeps it under Jobs.
 */
const AUTO_CLOSE_MS = 5000;

export function JobTray(props: {
  client: PipelineClient;
  jobs: Job[];
  collapsed: boolean;
  onCollapse(collapsed: boolean): void;
  onReview(): void;
  onDetails(jobId: string): void;
  onHeight(px: number): void;
}) {
  const { client, onHeight } = props;
  const ref = useRef<HTMLDivElement>(null);
  const hasJobs = props.jobs.length > 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return void onHeight(0);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => { ro.disconnect(); onHeight(0); };
  }, [hasJobs, onHeight]);

  // A finished job closes itself after 5s, like any notification (paused while the mouse is on the tray).
  // It stays under Jobs in the top bar; failures and conflicts also stay in the header.
  const [hovered, setHovered] = useState(false);
  const finished = props.jobs.filter((j) => client.jobDone(j)).map((j) => j.id).join();
  useEffect(() => {
    if (hovered || !finished) return;
    const timers = finished.split(',').map((id) => setTimeout(() => client.dismissJob(id), AUTO_CLOSE_MS));
    return () => timers.forEach(clearTimeout);
  }, [client, finished, hovered]);
  const hover = { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };

  if (!hasJobs) return null;
  const top = client.peekHistory();

  if (props.collapsed) {
    const running = props.jobs.filter((j) => jobStatus(client, j).running);
    const first = running[0] ?? props.jobs[0];
    const label = running.length > 1 ? `${running.length} jobs running` : first.label;
    return (
      <div ref={ref} className="fixed right-6 bottom-6 z-40">
        <button
          type="button"
          onClick={() => props.onCollapse(false)}
          className="flex max-w-[356px] items-center gap-2 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-lg hover:bg-muted"
          aria-label="Show bulk jobs"
        >
          {running.length > 0 && <Loader2 className="size-3.5 shrink-0 animate-spin" />}
          <span className="truncate font-medium">{label}</span>
          <span className="shrink-0 text-muted-foreground">{jobStatus(client, first).text}</span>
          <ChevronUp className="size-3.5 shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="pointer-events-none fixed right-6 bottom-6 z-40 flex w-[356px] flex-col gap-2">
      {props.jobs.map((job, i) => {
        const c = job.counts;
        const done = c.ok + c.failed + c.conflict + c.skipped;
        const finished = client.jobDone(job);
        const open = client.openConflicts(job);
        // Server jobs (select all): the server does the work; Stop asks it to skip what's left.
        const server = job.server;
        const starting = !!server && !server.id && !server.startError;
        const canStop = !!server?.id && !finished && !job.cancelled;
        const stop = () => {
          client.cancelJob(job.id);
          toast('Stopping…', { id: `cancel-${job.id}`, description: 'Deals not done yet will be skipped. Already moved ones stay moved (Undo puts them back).' });
        };
        return (
          <div key={job.id} className="pointer-events-auto rounded-lg border bg-popover p-3 text-sm shadow-lg" role="status" {...hover}>
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{job.label}</span>
              <span className="flex shrink-0 gap-1">
                {i === 0 && (
                  <button type="button" aria-label="Minimise (the job keeps running)" title="Minimise (the job keeps running)" className="text-muted-foreground hover:text-foreground" onClick={() => props.onCollapse(true)}>
                    <ChevronDown className="size-4" />
                  </button>
                )}
                {(finished || server?.startError) && (
                  <button type="button" aria-label="Close (still listed under Jobs)" title="Close (still listed under Jobs)" className="text-muted-foreground hover:text-foreground" onClick={() => client.dismissJob(job.id)}>
                    <X className="size-4" />
                  </button>
                )}
              </span>
            </div>
            {server?.startError ? (
              <p className="my-2 text-xs text-destructive">{server.startError} Nothing was moved.</p>
            ) : (
              <Progress value={job.total ? (done / job.total) * 100 : 100} className="my-2" />
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="tabular-nums">{starting ? 'Starting…' : `${fmtNum(done)} / ${fmtNum(job.total)}`}</span>
              <Badge variant="secondary" className="text-emerald-700 dark:text-emerald-400">✓ {fmtNum(c.ok)} saved</Badge>
              {c.failed > 0 && <Badge variant="destructive">✕ {fmtNum(c.failed)} failed</Badge>}
              {open > 0 ? (
                <button type="button" onClick={props.onReview} title="Review conflicts" className="cursor-pointer">
                  <Badge variant="outline" className="border-amber-400 text-amber-800 underline-offset-2 hover:underline dark:text-amber-300">⚠ {fmtNum(open)} conflicts · Review</Badge>
                </button>
              ) : c.conflict > 0 && <Badge variant="outline">{fmtNum(c.conflict)} conflicts resolved</Badge>}
              {c.skipped > 0 && <Badge variant="outline">{fmtNum(c.skipped)} skipped</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {server?.startError && <Button size="xs" variant="outline" onClick={() => client.restartJob(job.id)}>Try again</Button>}
              {canStop && <Button size="xs" variant="outline" onClick={stop}>Stop <Kbd>⇧S</Kbd></Button>}
              {!finished && job.cancelled && <span className="self-center text-xs text-muted-foreground">Stopping…</span>}
              {c.failed > 0 && (
                <Button size="xs" variant="destructive" onClick={() => client.retryJobFailed(job.id)}>
                  Retry {fmtNum(c.failed)} failed
                </Button>
              )}
              {top?.jobId === job.id && <Button size="xs" variant="ghost" onClick={() => client.undo()}>Undo <Kbd>z</Kbd></Button>}
              <Button size="xs" variant="ghost" className="ml-auto" onClick={() => props.onDetails(job.id)}>Details</Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
