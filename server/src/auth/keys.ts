import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { Store } from '../registry/store.js';

export type AuthKeys = { secret: Uint8Array; signing: Keypair };

/**
 * The JWT secret and the challenge-signing keypair are generated once and kept in `settings`, so a
 * fresh deployment needs no secret env vars and a restart keeps every session valid. Self-generation
 * goes through `putSettingIfAbsent` (insert-only) rather than `setSetting` (last-writer-wins) so two
 * instances cold-booting at once converge on the same secret instead of each minting its own.
 * `AUTH_SECRET` (base64, 32 bytes) and `AUTH_SIGNING_SEED` (S…) override without being written back —
 * tests use that.
 */
export async function loadAuthKeys(store: Store, env: NodeJS.ProcessEnv): Promise<AuthKeys> {
  const secretB64 = env.AUTH_SECRET || (await store.getSetting('auth_secret')) || (await store.putSettingIfAbsent('auth_secret', randomBytes(32).toString('base64')));
  const seed = env.AUTH_SIGNING_SEED || (await store.getSetting('auth_signing_seed')) || (await store.putSettingIfAbsent('auth_signing_seed', Keypair.random().secret()));
  const secret = Buffer.from(secretB64, 'base64');
  if (secret.length < 32) throw new Error('AUTH_SECRET must be 32 random bytes, base64-encoded');
  return { secret: new Uint8Array(secret), signing: Keypair.fromSecret(seed) };
}
