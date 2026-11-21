import { useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { PipelineClient, RemoteChange } from '@/features/deals/api/pipelineClient';
import { fmtAgo, plural } from '@/shared/utils/format';
import { cn } from '@/shared/utils/cn';
import { changeText } from '@/features/deals/utils/changeText';
import { Button } from '@/shared/ui/button';
import { Kbd } from '@/shared/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

/**
 * "14 updates from others ▾". Never interrupts: it only opens when clicked.
 * Clicking a change opens that deal in a side panel OVER the list, so your
 * place (scroll, selection, highlighted deal) is untouched. "Apply N changes"
 * moves the affected cards into place and keeps your selection and highlighted deal.
 */
export function UpdatesMenu(props: {
  client: PipelineClient; count: number; isRelevant(id: string): boolean; now: number;
  onOpenDeal(id: string): void;
  /** An action on several deals: open the list of what changed. */
  onOpenChange(c: RemoteChange): void;
  onRefresh(): void;
}) {
  const [open, setOpen] = useState(false);
  if (props.count === 0) return null;
  const items = props.client.recentActivity().filter((a) => (a.ids ?? [a.id]).some(props.isRelevant)).slice(0, 12);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Pulses once when it appears (e.g. after a teammate's bulk move): the button itself is the notice. */}
        <Button size="xs" variant="secondary" className="ml-auto animate-attention">
          <RefreshCw />{plural(props.count, 'update')} from others <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ul className="max-h-80 overflow-y-auto py-1">
          {items.map((a, i) => (
            <li key={`${a.id}-${a.at}-${i}`}>
              <button
                type="button"
                onClick={() => { setOpen(false); if (a.count > 1) props.onOpenChange(a); else props.onOpenDeal(a.id); }}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', props.client.hasExternalChange(a.id) ? 'bg-sky-500' : 'bg-transparent')} />
                <span className="min-w-0 flex-1 truncate">
                  <strong className="font-medium">{a.self ? 'You (other tab)' : a.by}</strong> {changeText(a.what, a.name)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtAgo(a.at, props.now)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">Click a change to open the deal</span>
          <Button size="xs" onClick={() => { setOpen(false); props.onRefresh(); }} title="Shortcut: . (full stop)">
            Apply {plural(props.count, 'change')} <Kbd>.</Kbd>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
