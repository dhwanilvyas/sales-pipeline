import { cn } from '@/shared/utils/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { reasonLabel, reasonShortLabel, type Reason } from '@/entities/deal/deal.priority';

const tone = (r: Reason) =>
  r.kind === 'overdue' || r.kind === 'due-today' ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
    : r.kind === 'closing' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      : 'bg-muted text-muted-foreground';

/**
 * "Follow-up 3d overdue", "Closes in 2d"… — why a deal needs attention.
 * `compact` (board cards) shows the short form ("Overdue 3d") with the full text in a tooltip.
 */
export function ReasonChips({ reasons, max = 2, compact = false }: { reasons: Reason[]; max?: number; compact?: boolean }) {
  return (
    <>
      {reasons.slice(0, max).map((r) => {
        const chip = (
          <span key={r.kind} className={cn('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px]', !compact && 'truncate', tone(r))}>
            {compact ? reasonShortLabel(r) : reasonLabel(r)}
          </span>
        );
        if (!compact) return chip;
        return (
          <Tooltip key={r.kind}>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent>{reasonLabel(r)}</TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
