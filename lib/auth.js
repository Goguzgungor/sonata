'use client';
import * as wallet from './wallet';
import { auth } from './api';
import { setSession, clearSession } from './session';

/** Wallet connect → SEP-10 challenge → wallet signature → session token. Throws WalletError or ApiError. */
export async function signIn() {
  const address = await wallet.connect();
  const net = await wallet.getNetwork();
  const ch = await auth.challenge(address, net.network);
  const signed = await wallet.signTransaction(ch.transaction, ch.network_passphrase, address);
  const t = await auth.token(signed, net.network);
  const session = { token: t.token, address: t.address, expires_at: t.expires_at };
  setSession(session);
  return session;
}
export function signOut() {
  clearSession();
  wallet.disconnect().catch(() => {});
}
