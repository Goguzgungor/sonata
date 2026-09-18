'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `fetcher(signal)` on mount and whenever `deps` change; aborts stale requests; ignores their results. */
export function useApi(fetcher, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ctrl = useRef(null);
  const run = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher(c.signal);
      if (!c.signal.aborted) setState({ data, error: null, loading: false });
    } catch (error) {
      if (!c.signal.aborted && error?.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); return () => ctrl.current?.abort(); }, [run]);
  return { ...state, refetch: run };
}

/** Re-runs `fetcher` every `every` ms until `until(data)` is true (or `enabled` is false). */
export function usePoll(fetcher, { every = 1500, until, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher;
  const untilRef = useRef(until); untilRef.current = until;
  useEffect(() => {
    if (!enabled) return;
    setState({ data: null, error: null, loading: true });
    let stopped = false; let timer = null;
    const tick = async () => {
      try {
        const data = await fetcherRef.current();
        if (stopped) return;
        setState({ data, error: null, loading: false });
        if (untilRef.current && untilRef.current(data)) return;
      } catch (error) {
        if (stopped) return;
        setState((s) => ({ ...s, error, loading: false }));
      }
      timer = setTimeout(tick, every);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [enabled, every]);
  return state;
}
