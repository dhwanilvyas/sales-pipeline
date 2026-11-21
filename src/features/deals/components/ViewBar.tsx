import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { fmtNum } from '@/shared/utils/format';
import { cn } from '@/shared/utils/cn';
import { VIEWS, type Query, type ViewId } from '@/entities/deal';

/**
 * The views, with their counts, and the layout switch at the right end: your views first, then
 * (after a divider) All deals. Preset for the demo; users would add their own in a full product.
 */
export function ViewBar(props: { query: Query; counts: Record<ViewId, number>; onView(v: ViewId): void; /** Shown at the right end (the layout switch). */ end?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Tabs value={props.query.view} onValueChange={(v) => props.onView(v as ViewId)}>
        <TabsList>
          {VIEWS.map((v) => (
            <TabsTrigger key={v.id} value={v.id} title={`${v.hint} (g ${v.key})`} className={cn('gap-1.5', v.id === 'all' && 'ml-3 before:absolute before:-left-2 before:h-4 before:w-px before:bg-border')}>
              {v.label}
              <span className="rounded px-1 text-[11px] tabular-nums text-muted-foreground">{fmtNum(props.counts[v.id])}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {props.end && <div className="ml-auto">{props.end}</div>}
    </div>
  );
}
