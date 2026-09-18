import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { MemoryStore } from '../../src/registry/store.js';
import { loadAuthKeys } from '../../src/auth/keys.js';

describe('loadAuthKeys', () => {
  it('generates a secret and a signing seed once and persists them in settings', async () => {
    const store = new MemoryStore();
    const a = await loadAuthKeys(store, {});
    expect(a.secret).toHaveLength(32);
    expect(a.signing.publicKey()).toMatch(/^G/);
    expect(await store.getSetting('auth_secret')).toBe(Buffer.from(a.secret).toString('base64'));
    expect(await store.getSetting('auth_signing_seed')).toBe(a.signing.secret());
    const b = await loadAuthKeys(store, {});
    expect(Buffer.from(b.secret).equals(Buffer.from(a.secret))).toBe(true);
    expect(b.signing.publicKey()).toBe(a.signing.publicKey());
  });
  it('env overrides win and are not written back', async () => {
    const store = new MemoryStore();
    const kp = Keypair.random();
    const secret = Buffer.alloc(32, 7).toString('base64');
    const a = await loadAuthKeys(store, { AUTH_SECRET: secret, AUTH_SIGNING_SEED: kp.secret() });
    expect(Buffer.from(a.secret).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(a.signing.publicKey()).toBe(kp.publicKey());
    expect(await store.getSetting('auth_secret')).toBeNull();
  });
});
