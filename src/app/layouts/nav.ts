import { KanbanSquare, type LucideIcon } from 'lucide-react';

/** The app's pages, for the sidebar and the page title. Add a page: an entry here + a route in router.tsx + src/features/<name>/. */
export const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/deals', label: 'Deals', icon: KanbanSquare },
];

export const pageTitle = (pathname: string) => NAV.find((n) => pathname.startsWith(n.to))?.label ?? '';
