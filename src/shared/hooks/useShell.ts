import { createContext, useContext } from 'react';

/** What pages and features can ask of the app shell (global dialogs). Provided by app/AppShell. */
export interface ShellValue {
  openHelp(): void;
  openSim(): void;
  /** The "Unsaved changes" panel (conflicts + failed saves): open from anywhere, rendered by the deals page. */
  reviewOpen: boolean;
  openReview(): void;
  closeReview(): void;
  /** The bulk job whose per-deal details panel is open (rendered by the deals page). */
  jobDetailsId: string | null;
  openJobDetails(id: string): void;
  closeJobDetails(): void;
  /** True while a global dialog is open: pages should not handle their own shortcuts then. */
  overlayOpen: boolean;
  /** Where a page can put controls next to its title in the top bar (via a portal); null until mounted. */
  titleSlot: HTMLElement | null;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = useContext(ShellContext);
  if (!v) throw new Error('useShell must be used inside <AppShell>');
  return v;
}
