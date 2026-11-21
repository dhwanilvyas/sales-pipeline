import type { LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Kbd } from '@/shared/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

/** A "pick one" switch (radio group styled as segmented buttons). Generic: no business logic. */
export function SegmentedControl<T extends string>(props: {
  label: string;
  value: T;
  onChange(v: T): void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  /** Keyboard shortcut that toggles between options, shown in each option's tooltip. */
  shortcut?: string;
  /** Compact: icons only, the label goes in the tooltip and the accessible name. */
  iconOnly?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className={cn('inline-flex rounded-lg bg-muted text-sm', props.iconOnly ? 'p-0.5' : 'p-1')}>
      {props.options.map(({ value, label, icon: Icon }) => {
        const active = props.value === value;
        const button = (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={props.iconOnly ? label : undefined}
            aria-keyshortcuts={props.shortcut}
            onClick={() => props.onChange(value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              props.iconOnly ? 'p-1.5' : 'px-3 py-1.5',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {!props.iconOnly && label}
          </button>
        );
        // With text labels the active option needs no tooltip; icon-only options always get one.
        if (!props.iconOnly && (!props.shortcut || active)) return button;
        return (
          <Tooltip key={value}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              {active ? label : <>Switch to {label}{props.shortcut && <> <Kbd>{props.shortcut}</Kbd></>}</>}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
