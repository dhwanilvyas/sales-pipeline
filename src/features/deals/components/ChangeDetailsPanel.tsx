import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { STAGE_LABEL } from '@/entities/deal';
import type { PipelineClient, RemoteChange } from '@/features/deals/api/pipelineClient';
import { changeText } from '@/features/deals/utils/changeText';
import { fmtAgo, fmtINR, plural } from '@/shared/utils/format';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';

const ROW = 44;

/**
 * "View" on a notification about your deals: exactly what changed. One action
 * ("Riya moved 40 of your deals to Lost") or several (e.g. "While you were
 * offline"). Each row: the deal, what changed on it (stage or owner, before →
 * after), who did it when there are several actions, and its value, so a big
 * one stands out. Click a deal to find it on the board. Virtualised.
 */
export function ChangeDetailsPanel(props: {
  client: PipelineClient;
  /** The action(s) to show; null = closed. */
  changes: { title: string; items: RemoteChange[] } | null;
  now: number;
  onClose(): void;
  onShowDeal(id: string): void;
}) {
  const { client, changes } = props;
  const many = (changes?.items.length ?? 0) > 1;
  const rows = changes ? changes.items.flatMap((c) => c.deals.map((d) => ({ ...d, by: c.by, at: c.at }))) : [];
  const first = changes?.items[0];

  return (
    <Sheet open={!!changes} onOpenChange={(o) => !o && props.onClose()} modal={false}>
      {/* Opened from a toast that then disappears: losing focus that way must not close the panel. */}
      <SheetContent className="flex w-[520px] flex-col shadow-2xl sm:max-w-[520px]" onFocusOutside={(e) => e.preventDefault()}>
        {changes && first && (
          <SheetHeader>
            <SheetTitle>{changes.title}</SheetTitle>
            <SheetDescription>
              {many ? plural(rows.length, 'deal') : fmtAgo(first.at, props.now)}. Click a deal to find it on the board.
            </SheetDescription>
          </SheetHeader>
        )}
        {changes && <Rows key={changes.items.map((c) => c.at).join()} client={client} rows={rows} many={many} onShowDeal={props.onShowDeal} />}
      </SheetContent>
    </Sheet>
  );
}

type Row = RemoteChange['deals'][number] & { by: string; at: number };

/** The list, created fresh each time the panel opens (the virtualizer binds to its own scroll element). */
function Rows(props: { client: PipelineClient; rows: Row[]; many: boolean; onShowDeal(id: string): void }) {
  const { client, rows, many } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 8 });
  return (
    <div ref={scrollRef} className="mx-4 mb-4 min-h-0 flex-1 overflow-y-auto rounded-lg border text-sm">
      <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const r = rows[vi.index];
          const deal = client.getView(r.id)?.deal;
          if (!deal) return null;
          const what = r.from !== r.to ? `${STAGE_LABEL[r.from]} → ${STAGE_LABEL[r.to]}`
            : r.fromOwner !== r.toOwner ? `Owner ${r.fromOwner} → ${r.toOwner}`
            : r.fromValue !== r.toValue ? `Value ${fmtINR(r.fromValue)} → ${fmtINR(r.toValue)}`
            : 'Activity logged';
          return (
            <li key={`${r.id}-${vi.index}`} className="absolute inset-x-0 border-b last:border-b-0" style={{ top: vi.start, height: ROW }}>
              <div className="flex h-full items-center gap-2 px-3">
                <button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => props.onShowDeal(r.id)} title="Show on the board">
                  {deal.name}
                </button>
                {many && <span className="shrink-0 text-xs text-muted-foreground">{r.by}</span>}
                <span className="shrink-0 text-xs">{what}</span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmtINR(deal.value)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Riya moved 40 deals to Lost" / "Rahul moved Acme to Won": the panel's title for one action. */
export const changeTitle = (c: RemoteChange) => `${c.by} ${changeText(c.what, c.count === 1 ? c.name : plural(c.count, 'deal'))}`;
