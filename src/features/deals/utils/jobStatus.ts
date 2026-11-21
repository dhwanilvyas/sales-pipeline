import type { Job, PipelineClient } from '@/features/deals/api/pipelineClient';
import { fmtNum } from '@/shared/utils/format';

/** One line about a job, for the minimised tray and the Jobs menu: "Running · 21%", "Done · 3 failed"… */
export function jobStatus(client: PipelineClient, job: Job) {
  const c = job.counts;
  const done = c.ok + c.failed + c.conflict + c.skipped;
  const pct = job.total ? Math.floor((done / job.total) * 100) : 100;
  const finished = client.jobDone(job);
  const running = !finished && !job.server?.startError;
  let text: string;
  if (job.server?.startError) text = "Couldn't start";
  else if (!finished) text = job.cancelled ? 'Stopping…' : job.server && !job.server.id ? 'Starting…' : `Running · ${pct}%`;
  else {
    const extra = [c.failed && `${fmtNum(c.failed)} failed`, c.conflict && `${fmtNum(c.conflict)} conflicts`, c.skipped && `${fmtNum(c.skipped)} skipped`].filter(Boolean);
    text = `${job.cancelled ? 'Stopped' : 'Done'}${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
  }
  return { done, pct, finished, running, text };
}
