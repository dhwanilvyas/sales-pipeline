import { useLayoutEffect, useMemo, useRef } from 'react';

type Fns = Record<string, (...args: any[]) => any>;

/**
 * Returns functions whose identity never changes but that always run the
 * latest version passed in. For handlers given to memoised children (cards,
 * rows): they stay stable, so a card doesn't re-render just because the
 * parent did, and they never see stale state.
 */
export function useStableCallbacks<T extends Fns>(fns: T): T {
  const latest = useRef(fns);
  useLayoutEffect(() => {
    latest.current = fns;
  });
  const keys = Object.keys(fns).join(',');
  return useMemo(() => {
    const out: Fns = {};
    for (const k of keys.split(',')) out[k] = (...args) => latest.current[k](...args);
    return out as T;
  }, [keys]);
}
