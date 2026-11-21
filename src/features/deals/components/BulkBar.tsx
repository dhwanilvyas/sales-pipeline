import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Kbd } from '@/shared/ui/kbd';
import { fmtNum, plural } from '@/shared/utils/format';
import { STAGES, STAGE_LABEL, type Stage } from '@/entities/deal';

export interface PendingConfirm { target: Stage; count: number }

/** Actions for the current selection, or the confirmation for a big bulk move. */

export function BulkBar(props: {
  selected: number;
  /** Offline or server unreachable: new changes are paused. */
  bulkBlocked: boolean;
  inView: number;
  issues: { failed: number; conflict: number };
  confirm: PendingConfirm | null;
  onSelectAll(): void;
  onMove(s: Stage): void;
  onConfirm(): void;
  onCancelConfirm(): void;
  onRetry(): void;
  onKeepTheirs(): void;
  onApplyMine(): void;
  onClear(): void;
}) {
  if (props.confirm) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40" role="alertdialog" aria-label="Confirm bulk move">
        <AlertTriangle className="size-4 text-amber-700" />
        <span>Move <strong>{plural(props.confirm.count, 'deal')}</strong> to <strong>{STAGE_LABEL[props.confirm.target]}</strong>? You can undo it afterwards.</span>
        <Button size="sm" autoFocus onClick={props.onConfirm}>Move {fmtNum(props.confirm.count)} <Kbd>⏎</Kbd></Button>
        <Button size="sm" variant="ghost" onClick={props.onCancelConfirm}>Cancel <Kbd>Esc</Kbd></Button>
      </div>
    );
  }
  if (!props.selected) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm" role="toolbar" aria-label="Bulk actions">
      <strong>{plural(props.selected, 'deal')} selected</strong>
      {props.selected < props.inView && (
        <Button size="xs" variant="link" onClick={props.onSelectAll}>Select all {fmtNum(props.inView)} in this view <Kbd>Ctrl A</Kbd></Button>
      )}
      <span className="ml-2 text-muted-foreground">{props.bulkBlocked ? 'Changes paused until you\'re back online' : 'Move to'}</span>
      {STAGES.map((s, i) => (
        <Button key={s} size="xs" variant="outline" disabled={props.bulkBlocked} onClick={() => props.onMove(s)}>
          {STAGE_LABEL[s]} <Kbd>{i + 1}</Kbd>
        </Button>
      ))}
      {props.issues.failed > 0 && <Button size="xs" variant="destructive" onClick={props.onRetry}>Retry {fmtNum(props.issues.failed)} <Kbd>r</Kbd></Button>}
      {props.issues.conflict > 0 && (
        <>
          <Button size="xs" variant="outline" onClick={props.onKeepTheirs}>Keep theirs ({fmtNum(props.issues.conflict)}) <Kbd>t</Kbd></Button>
          <Button size="xs" variant="outline" onClick={props.onApplyMine}>Apply mine <Kbd>o</Kbd></Button>
        </>
      )}
      <Button size="xs" variant="ghost" className="ml-auto" onClick={props.onClear}><X />Clear <Kbd>Esc</Kbd></Button>
    </div>
  );
}
