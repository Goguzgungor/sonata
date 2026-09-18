'use client';
import { PASSPHRASES } from './api';

const WALLET_KEY = 'sonata.wallet';
let kitPromise = null;

export class WalletError extends Error {
  constructor(code, message) { super(message); this.name = 'WalletError'; this.code = code; }
}
/** Wallets phrase rejections and mismatches differently; the UI only needs four buckets. */
function normalise(e) {
  if (e instanceof WalletError) return e;
  const m = String(e?.message || e || '');
  if (/reject|declin|denied|cancel|closed|abort/i.test(m)) return new WalletError('rejected', 'The wallet request was cancelled.');
  if (/network|passphrase/i.test(m)) return new WalletError('network', 'Your wallet is on a different network.');
  if (/not (installed|available|found)|unavailable|no wallet/i.test(m)) return new WalletError('unavailable', 'No Stellar wallet is available in this browser.');
  return new WalletError('unknown', m || 'The wallet returned an error.');
}

/** The kit touches `window` at import time, so it is loaded lazily and only in the browser. */
async function kit() {
  if (!kitPromise) {
    kitPromise = (async () => {
      const [{ StellarWalletsKit }, { FreighterModule }, { xBullModule }, { AlbedoModule }, { LobstrModule }] = await Promise.all([
        import('@creit.tech/stellar-wallets-kit/sdk'),
        import('@creit.tech/stellar-wallets-kit/modules/freighter'),
        import('@creit.tech/stellar-wallets-kit/modules/xbull'),
        import('@creit.tech/stellar-wallets-kit/modules/albedo'),
        import('@creit.tech/stellar-wallets-kit/modules/lobstr')
      ]);
      StellarWalletsKit.init({ modules: [new FreighterModule(), new xBullModule(), new AlbedoModule(), new LobstrModule()] });
      return StellarWalletsKit;
    })().catch((e) => { kitPromise = null; throw normalise(e); });
  }
  return kitPromise;
}
export function _setKitForTests(k) { kitPromise = Promise.resolve(k); }

export async function connect() {
  const k = await kit();
  try {
    const { address } = await k.authModal();
    try { localStorage.setItem(WALLET_KEY, k.selectedModule?.productId || 'connected'); } catch {}
    return address;
  } catch (e) { throw normalise(e); }
}
export async function getAddress() {
  try { const { address } = await (await kit()).getAddress(); return address || null; } catch { return null; }
}
export async function getNetwork() {
  try {
    const n = await (await kit()).getNetwork();
    const mainnet = n?.networkPassphrase === PASSPHRASES.mainnet || /public|mainnet/i.test(String(n?.network || ''));
    return mainnet ? { network: 'mainnet', networkPassphrase: PASSPHRASES.mainnet } : { network: 'testnet', networkPassphrase: PASSPHRASES.testnet };
  } catch { return { network: 'testnet', networkPassphrase: PASSPHRASES.testnet }; }
}
export async function signTransaction(xdr, networkPassphrase, address) {
  const k = await kit();
  try { const { signedTxXdr } = await k.signTransaction(xdr, { networkPassphrase, address }); return signedTxXdr; }
  catch (e) { throw normalise(e); }
}
export async function disconnect() {
  try { localStorage.removeItem(WALLET_KEY); } catch {}
  try { const k = await kit(); if (typeof k.disconnect === 'function') await k.disconnect(); } catch {}
}
