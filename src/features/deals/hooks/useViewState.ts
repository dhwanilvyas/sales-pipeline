import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import type { ViewState } from '@/features/deals/types';
import { isNavigation, parseViewState, writeViewState } from '@/features/deals/utils/urlState';

/**
 * What the Deals page shows lives in the URL, and only there: it's read from
 * the URL on every render and changing it writes the URL. So links can be
 * shared, Back/Forward work, and in-app links (e.g. "Review conflicts") just navigate.
 */
export function useViewState() {
  const [params, setParams] = useSearchParams();
  // Memoised on the URL so the 50k-deal query only reruns when the view really changes.
  const view = useMemo(() => parseViewState(params), [params]);

  // The router applies URL changes asynchronously, so changes made in quick
  // succession (e.g. `g o` then `w`) must build on the newest one, not on the
  // last rendered view, or the first would be lost.
  const latest = useRef(view);
  useLayoutEffect(() => {
    latest.current = view;
  }, [view]);

  const changeView = useCallback((patch: Partial<ViewState>) => {
    const prev = latest.current;
    const next = { ...prev, ...patch };
    latest.current = next;
    setParams((p) => writeViewState(p, next), { replace: !isNavigation(prev, next) });
  }, [setParams]);

  return { view, changeView };
}
