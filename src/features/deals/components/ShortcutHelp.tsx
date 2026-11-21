import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Kbd } from '@/shared/ui/kbd';

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Navigate',
    items: [
      ['j / k  ·  ↓ / ↑', 'Previous / next deal'],
      ['h / l  ·  ← / →', 'Previous / next column (Board)'],
      ['Home / End  ·  PgUp / PgDn', 'Jump'],
      ['Enter', 'Open deal in side panel'],
      ['/', 'Search'],
      ['Esc', 'Close · clear selection'],
    ],
  },
  {
    title: 'Select',
    items: [
      ['x  ·  Space', 'Select / unselect'],
      ['Shift + ↓ / ↑', 'Extend selection'],
      ['Ctrl/⌘ + A', 'Select column (Board), again for whole view'],
    ],
  },
  {
    title: 'Move deals',
    items: [
      ['1 – 7', 'Move to stage'],
      ['] / [', 'Next / previous stage'],
      ['m', 'Move to stage… (picker; the selection, or the highlighted deal)'],
      ['z  ·  Ctrl/⌘ + Z', 'Undo'],
    ],
  },
  {
    title: 'Views',
    items: [
      ['b', 'Board ↔ Table'],
      ['g then p t q a', 'My deals · Follow up today · Gone quiet · All deals'],
      ['g then i', 'Unsaved changes (conflicts, failed saves)'],
      ['w', 'All deals: owner me ↔ anyone'],
      ['f then 1–7 / 0', 'Filter by stage / clear'],
      ['.', "Apply others' changes"],
    ],
  },
  {
    title: 'Sync problems',
    items: [
      ['r', 'Retry this deal'],
      ['Shift + R', 'Retry all failed'],
      ['Shift + S', 'Stop the running bulk job'],
      ['t / o', 'Conflict: keep theirs / apply mine'],
    ],
  },
  {
    title: 'App',
    items: [
      ['?', 'This help'],
      ['`', 'Simulator'],
    ],
  },
];

/** `?`: every shortcut, grouped. */
export function ShortcutHelp(props: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Works in both Board and Table. Moves apply to the selection if there is one, otherwise to the highlighted deal.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto p-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              <ul className="space-y-1.5 text-sm">
                {g.items.map(([k, d]) => (
                  <li key={k} className="flex items-center justify-between gap-4">
                    <span>{d}</span>
                    <Kbd className="shrink-0">{k}</Kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
