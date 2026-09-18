import { describe, it, expect } from 'vitest';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { signInAs, bearer } from '../helpers/session.js';
import { PASSPHRASES } from '../../src/config.js';

describe('auth routes', () => {
  it('challenge → token → me', async () => {
    const { app } = await testApp();
    const kp = Keypair.random();
    const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network: 'testnet' } });
    expect(ch.statusCode).toBe(200);
    expect(ch.json()).toMatchObject({ network_passphrase: PASSPHRASES.testnet });
    const { token, address } = await signInAs(app, kp);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ address, expires_at: expect.any(String) });
  });
  it('rejects bad input and unsigned/foreign challenges', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: 'nope', network: 'testnet' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: Keypair.random().publicKey(), network: 'futurenet' } })).statusCode).toBe(400);
    const kp = Keypair.random();
    const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network: 'testnet' } });
    const unsigned = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: ch.json().transaction, network: 'testnet' } });
    expect(unsigned.statusCode).toBe(401); expect(unsigned.json().error).toBe('invalid_challenge');
    const tx = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES.testnet); tx.sign(Keypair.random());
    expect((await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: tx.toXDR(), network: 'testnet' } })).statusCode).toBe(401);
  });
  it('/auth/me is 401 unauthorized without or with a bad token', async () => {
    const { app } = await testApp();
    const none = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(none.statusCode).toBe(401); expect(none.json()).toEqual({ error: 'unauthorized', message: expect.any(String) });
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: bearer('garbage') })).statusCode).toBe(401);
  });
  it('CORS preflight allows the Authorization header for a configured origin', async () => {
    const { app } = await testApp({ CORS_ORIGINS: 'https://sonata.test' });
    const res = await app.inject({ method: 'OPTIONS', url: '/auth/me', headers: { origin: 'https://sonata.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('https://sonata.test');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  });
});
