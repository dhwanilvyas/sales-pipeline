import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { STAGES, VIEWS, type Stage, type ViewId } from '@/entities/deal';

export type NavMove = 'down' | 'up' | 'pageDown' | 'pageUp' | 'home' | 'end';

/** What the keyboard can ask the deals screen to do. The screen implements these; this hook only maps keys. */
export interface ShortcutCommands {
  /** False while a dialog, menu or the side panel is open: they handle their own keys. */
  enabled: boolean;
  /** The list/board element; keys typed on other buttons keep their normal meaning. */
  container: RefObject<HTMLElement | null>;
  /** A big bulk move is waiting for confirmation: only Enter / Esc apply. */
  confirm: { accept(): void; cancel(): void } | null;

  navigate(move: NavMove, extendSelection: boolean): void;
  column(dir: 1 | -1): void;
  toggleSelect(): void;
  selectAll(): void;
  /** Returns false if there was nothing to clear (so Esc can do its default thing). */
  clearSelection(): boolean;

  moveToStage(stage: Stage): void;
  stepStage(dir: 1 | -1): void;
  openStageMenu(): void;
  /** Returns false if no deal is highlighted. */
  openPanel(): boolean;
  undo(): void;

  retry(): void;
  retryAll(): void;
  /** Stop the running bulk job (server job). */
  stopJob(): void;
  keepTheirs(): void;
  applyMine(): void;

  search(): void;
  applyChanges(): void;
  toggleLayout(): void;
  toggleScope(): void;
  showView(view: ViewId): void;
  filterStage(stage: Stage | null): void;
  /** Open the Unsaved changes panel. */
  review(): void;
  help(): void;
  simulator(): void;
}

/**
 * Single-key commands. Keep in sync with the `?` help (components/ShortcutHelp.tsx).
 * Two-key chords: `g` + view key (t o u s i), `f` + 1–7 / 0 (stage filter).
 */
const KEYS: Record<string, (c: ShortcutCommands, e: KeyboardEvent) => void> = {
  ArrowDown: (c, e) => c.navigate('down', e.shiftKey),
  j: (c, e) => c.navigate('down', e.shiftKey),
  ArrowUp: (c, e) => c.navigate('up', e.shiftKey),
  k: (c, e) => c.navigate('up', e.shiftKey),
  PageDown: (c, e) => c.navigate('pageDown', e.shiftKey),
  PageUp: (c, e) => c.navigate('pageUp', e.shiftKey),
  Home: (c, e) => c.navigate('home', e.shiftKey),
  End: (c, e) => c.navigate('end', e.shiftKey),
  ArrowRight: (c) => c.column(1),
  l: (c) => c.column(1),
  ArrowLeft: (c) => c.column(-1),
  h: (c) => c.column(-1),

  ' ': (c) => c.toggleSelect(),
  x: (c) => c.toggleSelect(),

  ']': (c) => c.stepStage(1),
  '[': (c) => c.stepStage(-1),
  m: (c) => c.openStageMenu(),
  z: (c) => c.undo(),

  r: (c) => c.retry(),
  R: (c) => c.retryAll(),
  S: (c) => c.stopJob(),
  t: (c) => c.keepTheirs(),
  o: (c) => c.applyMine(),

  '/': (c) => c.search(),
  '.': (c) => c.applyChanges(),
  b: (c) => c.toggleLayout(),
  w: (c) => c.toggleScope(),
  '?': (c) => c.help(),
  '`': (c) => c.simulator(),
};

const TYPING = 'input, textarea, select, [role="combobox"], [role="menu"], [role="slider"], [role="dialog"]';
const WIDGET = 'button, a, [role="tab"], [role="switch"], [role="radio"]';
const WIDGET_KEYS = [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/** Every keyboard shortcut of the deals screen, in one place. */
export function useShortcuts(commands: ShortcutCommands) {
  const ref = useRef(commands);
  useLayoutEffect(() => {
    ref.current = commands; // the listener below is registered once and reads the latest commands
  });
  const chord = useRef<{ key: 'g' | 'f'; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ref.current;
      if (!c.enabled || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest(TYPING)) return; // typing in a field
      const onWidget = target !== c.container.current && target !== document.body && target.closest(WIDGET);
      if (onWidget && WIDGET_KEYS.includes(e.key)) return; // let buttons/tabs keep Space, Enter, arrows

      if (chord.current) {
        const first = chord.current.key;
        clearTimeout(chord.current.timer);
        chord.current = null;
        e.preventDefault();
        if (first === 'g') {
          const view = VIEWS.find((v) => v.key === e.key.toLowerCase());
          if (view) c.showView(view.id);
          else if (e.key.toLowerCase() === 'i') c.review(); // "issues": the Unsaved changes panel
        } else {
          const n = Number(e.key);
          if (e.key === '0') c.filterStage(null);
          else if (n >= 1 && n <= STAGES.length) c.filterStage(STAGES[n - 1]);
        }
        return;
      }

      if (c.confirm) {
        if (e.key === 'Escape') { e.preventDefault(); c.confirm.cancel(); }
        else if (e.key === 'Enter') { e.preventDefault(); c.confirm.accept(); }
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'a') { e.preventDefault(); c.selectAll(); }
        else if (key === 'z' && !e.shiftKey) { e.preventDefault(); c.undo(); }
        return;
      }

      if (e.key === 'Escape') { if (c.clearSelection()) e.preventDefault(); return; }
      if (e.key === 'Enter') { if (c.openPanel()) e.preventDefault(); return; }
      if (e.key === 'g' || e.key === 'f') {
        e.preventDefault();
        chord.current = { key: e.key, timer: setTimeout(() => (chord.current = null), 1200) };
        return;
      }

      // Shift + j/k/h/l arrive as capitals: same movement, extending the selection.
      const run = KEYS[e.key] ?? ('JKHL'.includes(e.key) && e.key.length === 1 ? KEYS[e.key.toLowerCase()] : undefined);
      if (run) { e.preventDefault(); run(c, e); return; }

      const n = Number(e.key);
      if (n >= 1 && n <= STAGES.length) { e.preventDefault(); c.moveToStage(STAGES[n - 1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
