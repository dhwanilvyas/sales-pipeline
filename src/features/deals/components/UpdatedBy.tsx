import { cn } from '@/shared/utils/cn';
import { fmtAgo } from '@/shared/utils/format';
import type { DealView } from '@/features/deals/api/pipelineClient';

/**
 * "Rahul · just now". Flashes when someone else changed the deal; a teammate
 * touching one of MY deals gets a stronger marker.
 */
export function UpdatedBy({ view, me, now }: { view: DealView; me: string; now: number }) {
  const d = view.deal;
  const recentExternal = view.external && now - d.updatedAt < 10 * 60_000;
  const who = d.updatedBy === me ? 'You' : d.updatedBy;
  const mineTouched = recentExternal && d.owner === me && d.updatedBy !== me;
  return (
    <span key={d.version} className={cn('block truncate rounded px-1', recentExternal && 'animate-remote-flash', mineTouched && 'font-medium text-sky-700 dark:text-sky-300')}>
      {mineTouched && '● '}{who} · {fmtAgo(d.updatedAt, now)}
    </span>
  );
}
