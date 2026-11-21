import { cn } from '@/shared/utils/cn';
import { fmtINRCompact, fmtNum } from '@/shared/utils/format';
import { STAGES, STAGE_LABEL, type Stage, type StageTotals } from '@/entities/deal';
import { STAGE_STYLE } from '@/features/deals/utils/stageStyle';

/** Per-stage totals that double as a stage filter (table layout). */
export function StageBar(props: { totals: Record<Stage, StageTotals>; active: Stage | null; onStage(s: Stage | null): void }) {
  return (
    <div className="grid grid-cols-7 gap-1.5" role="toolbar" aria-label="Filter by stage (f then 1–7, f 0 clears)">
      {STAGES.map((s, i) => {
        const t = props.totals[s];
        const on = props.active === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => props.onStage(on ? null : s)}
            className={cn(
              'rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-muted',
              on && 'border-ring ring-2 ring-ring/40',
              props.active && !on && 'opacity-60',
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={cn('truncate rounded px-1.5 text-xs font-medium', STAGE_STYLE[s])}>{STAGE_LABEL[s]}</span>
              <span className="text-[10px] text-muted-foreground">{i + 1}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-1">
              <span className="text-sm font-semibold tabular-nums">{fmtNum(t.count)}</span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">{fmtINRCompact(t.value)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
