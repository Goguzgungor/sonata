import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { Store } from '../registry/store.js';

export type AuthKeys = { secret: Uint8Array; signing: Keypair };

/**
 * The JWT secret and the challenge-signing keypair are generated once and kept in `settings`, so a
 * fresh deployment needs no secret env vars and a restart keeps every session valid. `AUTH_SECRET`
 * (base64, 32 bytes) and `AUTH_SIGNING_SEED` (S…) override without being written back — tests use that.
 */
export async function loadAuthKeys(store: Store, env: NodeJS.ProcessEnv): Promise<AuthKeys> {
  const secretB64 = env.AUTH_SECRET || (await store.getSetting('auth_secret')) || (await persist(store, 'auth_secret', randomBytes(32).toString('base64')));
  const seed = env.AUTH_SIGNING_SEED || (await store.getSetting('auth_signing_seed')) || (await persist(store, 'auth_signing_seed', Keypair.random().secret()));
  return { secret: new Uint8Array(Buffer.from(secretB64, 'base64')), signing: Keypair.fromSecret(seed) };
}
async function persist(store: Store, key: string, value: string) { await store.setSetting(key, value); return value; }
