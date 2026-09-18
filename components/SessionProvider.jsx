'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSession, onSessionChange } from '@/lib/session';
import { signIn as doSignIn, signOut as doSignOut } from '@/lib/auth';

const Ctx = createContext(null);
const ANON = { session: null, address: null, status: 'anonymous', error: null, signIn: async () => { throw new Error('SessionProvider missing'); }, signOut: () => {} };

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);     // null until mount: localStorage is browser-only
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setSession(getSession()); return onSessionChange(setSession); }, []);
  const signIn = useCallback(async () => {
    setError(null); setSigning(true);
    try { return await doSignIn(); }
    catch (e) { setError(e); throw e; }
    finally { setSigning(false); }
  }, []);
  const signOut = useCallback(() => { setError(null); doSignOut(); }, []);
  const value = useMemo(() => ({ session, address: session?.address || null, status: signing ? 'signing' : session ? 'ready' : 'anonymous', error, signIn, signOut }), [session, signing, error, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx) || ANON;
