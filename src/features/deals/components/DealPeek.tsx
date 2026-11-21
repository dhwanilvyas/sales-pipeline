import { Crosshair } from 'lucide-react';
import { ReasonChips } from '@/features/deals/components/ReasonChips';
import { STAGES, STAGE_LABEL, prioritize, type Stage } from '@/entities/deal';
import { STAGE_STYLE } from '@/features/deals/utils/stageStyle';
import { UpdatedBy } from '@/features/deals/components/UpdatedBy';
import { type PipelineClient } from '@/features/deals/api/pipelineClient';
import { fmtAgo, fmtDate, fmtINR, fmtRelDay } from '@/shared/utils/format';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet';
import { SaveStatus } from './SaveStatus';
import type { DealActions } from '@/features/deals/types';

/**
 * A deal in a side panel over the list ("peek"). Opening it never scrolls,
 * re-sorts or changes the selection behind it; Esc returns you exactly where
 * you were. "Show in list" is the only thing that moves the list, on request.
 */
export function DealPeek(props: {
  client: PipelineClient;
  id: string | null;
  now: number;
  actions: DealActions;
  inList: boolean;
  onMove(id: string, stage: Stage): void;
  onShowInList(id: string): void;
  onClose(): void;
}) {
  const v = props.id ? props.client.getView(props.id) : undefined;
  const d = v?.deal;
  const history = props.id ? props.client.activityFor(props.id).slice(0, 8) : [];
  return (
    // Non-modal: the list stays visible and sharp beside the panel, so you never lose your place.
    <Sheet open={!!props.id} onOpenChange={(o) => !o && props.onClose()} modal={false}>
      <SheetContent className="w-[420px] overflow-y-auto shadow-2xl sm:max-w-[420px]" onFocusOutside={(e) => e.preventDefault() /* opened from a toast or menu that then closes */} onCloseAutoFocus={(e) => { e.preventDefault(); props.actions.focusContainer(); }}>
        {d && v && (
          <>
            <SheetHeader>
              <SheetTitle>{d.name}</SheetTitle>
              <SheetDescription>{d.id} · {d.licences} licences · owned by {d.owner === props.client.me ? 'you' : d.owner}</SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-6 text-sm">
              <div className="flex items-center gap-2">
                <Select value={d.stage} onValueChange={(s) => props.onMove(d.id, s as Stage)}>
                  <SelectTrigger size="sm" className={cn('w-44 font-medium', STAGE_STYLE[d.stage])} aria-label="Stage"><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map((s, i) => <SelectItem key={s} value={s}>{i + 1}. {STAGE_LABEL[s]}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-xs"><SaveStatus view={v} actions={props.actions} /></span>
              </div>
              <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
                <dt className="text-muted-foreground">Value</dt><dd className="tabular-nums">{fmtINR(d.value)}</dd>
                <dt className="text-muted-foreground">Follow-up</dt><dd>{d.nextStepAt == null ? '—' : `${fmtDate(d.nextStepAt)} (${fmtRelDay(d.nextStepAt, props.now)})`}</dd>
                <dt className="text-muted-foreground">Expected close</dt><dd>{fmtDate(d.expectedCloseAt)} ({fmtRelDay(d.expectedCloseAt, props.now)})</dd>
                <dt className="text-muted-foreground">Last activity</dt><dd>{fmtAgo(d.lastActivityAt, props.now)}</dd>
                <dt className="text-muted-foreground">Last update</dt><dd className="text-xs"><UpdatedBy view={v} me={props.client.me} now={props.now} /></dd>
              </dl>
              <div className="flex flex-wrap gap-1"><ReasonChips reasons={prioritize(d, props.now).reasons} max={4} /></div>
              <div>
                <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Recent changes by others</h3>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">None since you opened the app.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {history.map((a, i) => (
                      <li key={`${a.at}-${i}`}><strong className="font-medium">{a.self ? 'You (other tab)' : a.by}</strong> {a.what} · <span className="text-muted-foreground">{fmtAgo(a.at, props.now)}</span></li>
                    ))}
                  </ul>
                )}
              </div>
              <Button size="sm" variant="outline" disabled={!props.inList} onClick={() => props.onShowInList(d.id)}
                title={props.inList ? 'Scroll the list to this deal and highlight it' : 'Not in the current view'}>
                <Crosshair />{props.inList ? 'Show in list' : 'Not in this view'}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
