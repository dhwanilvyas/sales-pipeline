import type { MouseEvent } from 'react';
import { AlertTriangle, CloudOff, Loader2, RotateCw } from 'lucide-react';
import { STAGE_LABEL } from '@/entities/deal';
import { type DealView } from '@/features/deals/api/pipelineClient';
import type { DealActions } from '@/features/deals/types';

/** Save state of one deal: saving, waiting, retrying, failed (retry/discard), conflict (theirs/mine). */
export function SaveStatus({ view, actions, compact = false }: { view: DealView; actions: DealActions; compact?: boolean }) {
  const id = view.deal.id;
  const stop = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); fn(); };
  switch (view.status) {
    case null:
      return null;
    case 'queued':
      return <span className="text-muted-foreground">Queued</span>;
    case 'saving':
      return <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" />Saving…</span>;
    case 'waiting':
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title="Saved on this device. It will sync automatically when the connection is back.">
          <CloudOff className="size-3 shrink-0" />{compact ? 'Waiting to send' : 'Waiting to send · goes out when you\'re back'}
        </span>
      );
    case 'retrying':
      return <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400" title={view.error}><RotateCw className="size-3 animate-spin" />Retrying…</span>;
    case 'failed':
      return (
        <span className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400" title={view.error}>
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate font-medium">Not saved</span>
          <button type="button" tabIndex={-1} className="underline underline-offset-2" onClick={stop(() => actions.retry(id))}>Retry</button>
          <button type="button" tabIndex={-1} className="text-muted-foreground underline underline-offset-2" onClick={stop(() => actions.discard(id))}>Discard</button>
        </span>
      );
    case 'conflict': {
      const t = view.theirs!;
      return (
        <span className="flex min-w-0 items-center gap-1.5 text-amber-800 dark:text-amber-300"
          title={`${t.self ? 'You (in another tab)' : t.by} moved this to ${STAGE_LABEL[t.stage]}. You wanted ${STAGE_LABEL[view.deal.stage]}.`}>
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">{compact ? '' : `${t.self ? 'Other tab' : t.by}: `}{STAGE_LABEL[t.stage]}</span>
          <button type="button" tabIndex={-1} className="shrink-0 underline underline-offset-2" onClick={stop(() => actions.keepTheirs(id))}>Theirs</button>
          <button type="button" tabIndex={-1} className="shrink-0 underline underline-offset-2" onClick={stop(() => actions.applyMine(id))}>Mine</button>
        </span>
      );
    }
  }
}
