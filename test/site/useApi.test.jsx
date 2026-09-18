import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi, usePoll } from '@/lib/useApi';

describe('useApi', () => {
  it('resolves data', async () => {
    const { result } = renderHook(() => useApi(async () => ({ n: 1 }), []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 }); expect(result.current.error).toBeNull();
  });
  it('captures errors and refetches', async () => {
    let calls = 0;
    const { result } = renderHook(() => useApi(async () => { if (++calls === 1) throw new Error('boom'); return 'ok'; }, []));
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toBe('ok'); expect(result.current.error).toBeNull();
  });
  it('refetch keeps data and reports refetching', async () => {
    let release;
    let calls = 0;
    const { result } = renderHook(() => useApi(async () => {
      if (++calls === 1) return { n: 1 };
      await new Promise((r) => { release = r; });
      return { n: 2 };
    }, []));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    let done;
    act(() => { done = result.current.refetch(); });
    expect(result.current.loading).toBe(false);        // no skeleton flash: data is still on screen
    expect(result.current.refetching).toBe(true);
    expect(result.current.data).toEqual({ n: 1 });
    await act(async () => { release(); await done; });
    expect(result.current.data).toEqual({ n: 2 });
    expect(result.current.refetching).toBe(false);
    expect(result.current.loading).toBe(false);
  });
  it('re-runs when deps change and ignores stale results', async () => {
    const fetcher = vi.fn(async (signal, id) => { await new Promise((r) => setTimeout(r, id === 'a' ? 30 : 5)); return id; });
    const { result, rerender } = renderHook(({ id }) => useApi((signal) => fetcher(signal, id), [id]), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data).toBe('b'));
    await new Promise((r) => setTimeout(r, 40));
    expect(result.current.data).toBe('b');            // 'a' resolved later but was discarded
    expect(fetcher.mock.calls[0][0].aborted).toBe(true); // first request was aborted
  });
});

describe('usePoll', () => {
  it('polls until the predicate is true', async () => {
    let n = 0;
    const { result } = renderHook(() => usePoll(async () => ({ status: ++n >= 3 ? 'ready' : 'running' }), { every: 10, until: (d) => d.status === 'ready' }));
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(3);
  });
  it('does nothing when disabled', async () => {
    const f = vi.fn(async () => ({}));
    renderHook(() => usePoll(f, { every: 5, until: () => false, enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();
  });
  it('clears previous data when re-enabled', async () => {
    let n = 0;
    const { result, rerender } = renderHook(({ on }) => usePoll(async () => { await new Promise((r) => setTimeout(r, 5)); return { n: ++n }; }, { every: 5, until: () => true, enabled: on }), { initialProps: { on: true } });
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    rerender({ on: false });
    rerender({ on: true });
    expect(result.current.data).toBeNull();          // reset synchronously on restart
    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));
  });
});
