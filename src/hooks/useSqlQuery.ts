// Generic typed wrapper around the Mosaic coordinator's query method.
// Refetches when sql or any dep changes; caches in component state.

import { useEffect, useState } from 'react';
import { useMosaicCoordinator } from './useMosaicCoordinator';

export type SqlQueryState<T> = {
  rows: T[] | null;
  loading: boolean;
  error: string | null;
};

export function useSqlQuery<T>(
  sql: string | null,
  deps: ReadonlyArray<unknown> = [],
): SqlQueryState<T> {
  const { coordinator, isReady } = useMosaicCoordinator();
  const [state, setState] = useState<SqlQueryState<T>>({
    rows: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!isReady || !sql) return;
    let cancelled = false;
    // Synchronous setState during effect is the canonical fetch pattern —
    // we need the loading flag to flip immediately so consumers can render
    // a spinner before the async query resolves. The new
    // react-hooks/set-state-in-effect rule flags this generically; the
    // alternative (useReducer for one boolean) is uglier without changing
    // semantics. Suppressed locally with reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true, error: null }));
    coordinator
      .query(sql, { type: 'json' })
      .then((rows: unknown) => {
        if (cancelled) return;
        setState({ rows: rows as T[], loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ rows: null, loading: false, error: msg });
      });
    return () => {
      cancelled = true;
    };
    // sql is in deps explicitly; coordinator/isReady track readiness.
    // Caller-supplied deps go in the array as additional triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinator, isReady, sql, ...deps]);

  return state;
}
