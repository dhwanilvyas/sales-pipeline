import { AlertTriangle, CheckCircle2, CloudOff, Keyboard, Loader2, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/button';
import { Kbd } from '@/shared/ui/kbd';
import { fmtNum, plural } from '@/shared/utils/format';

/** Global bar: save status across the whole app, shortcuts and the simulator. (Who's signed in is in the sidebar.) */
export function TopBar(props: {
  /** The current page's name. */
  title: string;
  /** The page can render controls here, next to its title (e.g. the Deals page's pipeline). */
  titleSlotRef(el: HTMLElement | null): void;
  shared: boolean;
  summary: { saving: number; waiting: number; failed: number; conflicts: number };
  onRetryAll(): void;
  onReview(): void;
  onHelp(): void;
  /** Recent bulk jobs menu (hidden when there are none). */
  jobs?: ReactNode;
  /** Absent without a fake backend (nothing to simulate). */
  onSim?: () => void;
}) {
  const { summary: s } = props;
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
      <h1 className="text-base font-semibold">{props.title}</h1>
      <div ref={props.titleSlotRef} className="flex items-center" />
      {!props.shared && (
        <span className="text-xs text-amber-700" title="This browser has no SharedWorker, so each tab has its own fake server.">Multi-tab sync off</span>
      )}
      <div className="ml-auto flex items-center gap-2 text-xs" aria-live="polite">
        {s.saving > 0 && <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" />Saving {fmtNum(s.saving)}</span>}
        {s.waiting > 0 && <span className="inline-flex items-center gap-1 text-muted-foreground"><CloudOff className="size-3.5" />{plural(s.waiting, 'change')} waiting to sync</span>}
        {s.saving === 0 && s.waiting === 0 && s.failed === 0 && s.conflicts === 0 && <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="size-3.5" />All changes saved</span>}
        {s.failed > 0 && (
          <Button size="xs" variant="destructive" onClick={props.onRetryAll}>
            <AlertTriangle />{plural(s.failed, 'change')} not saved · Retry all <Kbd>⇧R</Kbd>
          </Button>
        )}
        {s.conflicts > 0 && (
          <Button size="xs" variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300" onClick={props.onReview}>
            {plural(s.conflicts, 'conflict')} · Review
          </Button>
        )}
        {props.jobs}
        <Button size="xs" variant="ghost" onClick={props.onHelp}><Keyboard />Shortcuts <Kbd>?</Kbd></Button>
        {props.onSim && <Button size="xs" variant="outline" onClick={props.onSim}><SlidersHorizontal />Simulator <Kbd>`</Kbd></Button>}
      </div>
    </header>
  );
}
