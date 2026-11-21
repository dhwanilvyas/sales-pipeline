import { matches, type Deal, type Query } from '@/entities/deal';

/**
 * Does someone else's change to this deal matter to the view I'm looking at?
 * Yes if the deal is on screen (Rahul moved my Acme), or if it now belongs in
 * the view (a deal was reassigned to me). Rahul moving his own deal while I'm
 * on My deals doesn't count, so "N updates from others" only counts what Apply
 * would actually change.
 */
export function relevantChange(onScreen: ReadonlySet<string>, getDeal: (id: string) => Deal | undefined, q: Query, now: number) {
  return (id: string) => {
    if (onScreen.has(id)) return true;
    const d = getDeal(id);
    return !!d && matches(d, q, now);
  };
}
