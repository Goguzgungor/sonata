import { describe, it, expect } from 'vitest';
import { issueToken, verifyToken, SESSION_TTL_S } from '../../src/auth/jwt.js';

const secret = new Uint8Array(32).fill(9);
const other = new Uint8Array(32).fill(1);
const ISS = 'https://api.sonata.test';
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('session tokens', () => {
  it('issues a 24h HS256 token and verifies it', async () => {
    const now = Date.parse('2026-09-18T12:00:00Z');
    const { token, expiresAt } = await issueToken(secret, ISS, G, now);
    expect(expiresAt).toBe(new Date(now + SESSION_TTL_S * 1000).toISOString());
    expect(await verifyToken(secret, ISS, token)).toEqual({ address: G, expiresAt });
  });
  it('rejects a wrong secret, a wrong issuer, garbage and an expired token', async () => {
    const { token } = await issueToken(secret, ISS, G);
    expect(await verifyToken(other, ISS, token)).toBeNull();
    expect(await verifyToken(secret, 'https://elsewhere', token)).toBeNull();
    expect(await verifyToken(secret, ISS, 'not.a.jwt')).toBeNull();
    const { token: old } = await issueToken(secret, ISS, G, Date.now() - (SESSION_TTL_S + 60) * 1000);
    expect(await verifyToken(secret, ISS, old)).toBeNull();
  });
});
