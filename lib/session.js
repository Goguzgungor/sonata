const KEY = 'sonata.session';
const listeners = new Set();
const notify = () => { const s = getSession(); for (const fn of listeners) fn(s); };

/** { token, address, expires_at } or null; an expired or unreadable entry is removed on read. */
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.token !== 'string' || typeof s.address !== 'string' || !(Date.parse(s.expires_at) > Date.now())) { localStorage.removeItem(KEY); return null; }
    return s;
  } catch { try { localStorage.removeItem(KEY); } catch {} return null; }
}
export function setSession(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} notify(); }
export function clearSession() { try { localStorage.removeItem(KEY); } catch {} notify(); }
export function onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
