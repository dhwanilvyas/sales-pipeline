import { CloudOff, ServerCrash } from 'lucide-react';
import type { Connection } from '@/features/deals/api/pipelineClient';
import { fmtNum, plural } from '@/shared/utils/format';
import { useNow } from '@/shared/hooks/useNow';
import { Button } from '@/shared/ui/button';

const time = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' });

/**
 * Says plainly what's going on when there's no connection: you can keep
 * browsing, new changes are paused (the board may be out of date), and changes
 * you'd already made are kept and go out by themselves when you're back.
 */
export function ConnectionBanner(props: {
  connection: Connection;
  offlineSince: number | null;
  nextProbeAt: number | null;
  /** A reconnect check is running right now. */
  checking: boolean;
  waiting: number;
  onRetryNow(): void;
}) {
  const now = useNow(1000);
  if (props.connection === 'online') return null;
  const pending = props.waiting > 0 ? ` ${plural(props.waiting, 'change')} you already made will be sent then.` : '';

  if (props.connection === 'offline') {
    return (
      <div role="status" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
        <CloudOff className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong>You're offline{props.offlineSince ? ` since ${time.format(props.offlineSince)}` : ''}.</strong>{' '}
          You can keep browsing, but changes are paused until you're back: deals may be out of date.{pending}
        </span>
      </div>
    );
  }
  const secs = props.nextProbeAt ? Math.max(0, Math.ceil((props.nextProbeAt - now) / 1000)) : 0;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-950 dark:bg-rose-950/40 dark:text-rose-100">
      <ServerCrash className="size-4 shrink-0" />
      <span className="flex-1">
        <strong>Can't reach the server.</strong> Changes are paused until it's back
        {props.checking ? '. Checking the connection now…' : secs > 0 ? `; next try in ${fmtNum(secs)}s.` : '.'}{pending}
      </span>
      <Button size="xs" variant="outline" disabled={props.checking} onClick={props.onRetryNow}>Retry now</Button>
    </div>
  );
}
