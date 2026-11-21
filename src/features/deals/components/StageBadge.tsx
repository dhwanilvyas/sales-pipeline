import { cn } from '@/shared/utils/cn';
import { STAGE_LABEL, type Stage } from '@/entities/deal/deal.types';
import { STAGE_STYLE } from '@/features/deals/utils/stageStyle';

/** Read-only stage pill (the editable one is the deals feature's StageMenu). */
export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STAGE_STYLE[stage], className)}>{STAGE_LABEL[stage]}</span>;
}
