import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSession, setSession, clearSession, onSessionChange } from '@/lib/session';

const future = () => new Date(Date.now() + 3600_000).toISOString();
const S = { token: 't', address: 'GABC', expires_at: future() };

describe('session store', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips through localStorage', () => {
    expect(getSession()).toBeNull();
    setSession(S);
    expect(getSession()).toEqual(S);
    expect(JSON.parse(localStorage.getItem('sonata.session'))).toEqual(S);
    clearSession();
    expect(getSession()).toBeNull();
  });
  it('drops an expired or malformed session on read', () => {
    localStorage.setItem('sonata.session', JSON.stringify({ ...S, expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('sonata.session')).toBeNull();
    localStorage.setItem('sonata.session', '{not json');
    expect(getSession()).toBeNull();
  });
  it('notifies listeners on set and clear', () => {
    const fn = vi.fn(); const off = onSessionChange(fn);
    setSession(S); expect(fn).toHaveBeenLastCalledWith(S);
    clearSession(); expect(fn).toHaveBeenLastCalledWith(null);
    off(); setSession(S); expect(fn).toHaveBeenCalledTimes(2);
  });
});
