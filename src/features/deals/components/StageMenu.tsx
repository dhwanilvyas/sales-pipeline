import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu';
import { cn } from '@/shared/utils/cn';
import { STAGES, STAGE_LABEL } from '@/entities/deal';
import { STAGE_STYLE } from '@/features/deals/utils/stageStyle';
import { type DealView } from '@/features/deals/api/pipelineClient';
import type { DealActions } from '@/features/deals/types';

/**
 * The stage control is a real dropdown: chevron + hover affordance, opens with
 * a click or `m`, arrow keys / Enter / 1–7 inside, and says so when the choice
 * applies to the whole selection.
 */
export function StageMenu({ view, open, bulkCount, actions }: { view: DealView; open: boolean; bulkCount: number; actions: DealActions }) {
  const d = view.deal;
  const pending = view.status && view.status !== 'conflict';
  return (
    <DropdownMenu open={open} onOpenChange={(o) => actions.setMenu(o ? d.id : null)}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Stage: ${STAGE_LABEL[d.stage]}. Change stage`}
          title="Change stage (click, m, or 1–7)"
          className={cn(
            'group/stage inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-xs font-medium ring-current/30 transition hover:ring-1 data-[state=open]:ring-2',
            STAGE_STYLE[d.stage],
            pending && 'ring-1 ring-dashed',
          )}
        >
          <span className="truncate">{STAGE_LABEL[d.stage]}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50 group-hover/stage:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        onClick={(e) => e.stopPropagation()}
        onCloseAutoFocus={(e) => { e.preventDefault(); actions.focusContainer(); }}
        onKeyDown={(e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= STAGES.length) {
            e.preventDefault();
            actions.setMenu(null);
            actions.pick(d.id, STAGES[n - 1]);
          }
        }}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {bulkCount ? `Move ${bulkCount} selected deals to` : 'Move to'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STAGES.map((s, i) => {
          const current = !bulkCount && s === d.stage;
          return (
            <DropdownMenuItem key={s} disabled={current} onSelect={() => actions.pick(d.id, s)}>
              <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', STAGE_STYLE[s])}>{STAGE_LABEL[s]}</span>
              {current && <Check className="size-3.5 text-muted-foreground" />}
              <DropdownMenuShortcut>{i + 1}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
