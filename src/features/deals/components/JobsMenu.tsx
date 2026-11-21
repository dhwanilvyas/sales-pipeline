import { useState } from 'react';
import { ListChecks, Loader2 } from 'lucide-react';
import type { PipelineClient } from '@/features/deals/api/pipelineClient';
import { jobStatus } from '@/features/deals/utils/jobStatus';
import { fmtAgo } from '@/shared/utils/format';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

/**
 * "Jobs" in the top bar: recent bulk moves, including ones closed in the tray.
 * Click one to bring it back into the tray; Details opens its per-deal list.
 */
export function JobsMenu(props: { client: PipelineClient; now: number; onShow(jobId: string): void; onDetails(jobId: string): void }) {
  const { client } = props;
  const [open, setOpen] = useState(false);
  const jobs = client.recentJobs();
  if (!jobs.length) return null;
  const running = jobs.filter((j) => jobStatus(client, j).running).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="Recent bulk jobs">
          {running ? <Loader2 className="animate-spin" /> : <ListChecks />}Jobs{running ? ` · ${running} running` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">Recent bulk moves. Click one to show it in the tray.</div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {jobs.map((job) => {
            const st = jobStatus(client, job);
            return (
              <li key={job.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setOpen(false); props.onShow(job.id); }}>
                  <span className="block truncate font-medium">{job.label}</span>
                  <span className={cn('text-xs', st.running ? 'text-foreground' : 'text-muted-foreground')}>
                    {st.text} · {fmtAgo(job.createdAt, props.now)}
                  </span>
                </button>
                <Button size="xs" variant="ghost" onClick={() => { setOpen(false); props.onDetails(job.id); }}>Details</Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
