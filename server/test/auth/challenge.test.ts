import { describe, it, expect } from 'vitest';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { PASSPHRASES } from '../../src/config.js';
import { buildChallenge, ChallengeVerifier, type ChallengeDeps } from '../../src/auth/challenge.js';

const deps: ChallengeDeps = { signing: Keypair.random(), homeDomain: 'sonata.test', webAuthDomain: 'api.sonata.test' };
const client = Keypair.random();
const sign = (xdr: string, kp: Keypair, network: 'testnet' | 'mainnet' = 'testnet') => { const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASES[network]); tx.sign(kp); return tx.toXDR(); };

describe('challenge', () => {
  it('builds a server-signed challenge for the address on the requested network', () => {
    const c = buildChallenge(deps, client.publicKey(), 'mainnet');
    expect(c.networkPassphrase).toBe(PASSPHRASES.mainnet);
    const tx = TransactionBuilder.fromXDR(c.transaction, PASSPHRASES.mainnet);
    expect(tx.source).toBe(deps.signing.publicKey());
    expect(tx.signatures).toHaveLength(1);
  });
  it('rejects a non-G address with 400 invalid_args', () => {
    expect(() => buildChallenge(deps, 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'testnet')).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args' }));
  });
  it('verifies a client-signed challenge exactly once', () => {
    const v = new ChallengeVerifier(deps);
    const signed = sign(buildChallenge(deps, client.publicKey(), 'testnet').transaction, client);
    expect(v.verify(signed, 'testnet')).toBe(client.publicKey());
    expect(() => v.verify(signed, 'testnet')).toThrow(expect.objectContaining({ status: 401, error: 'invalid_challenge' }));
  });
  it('rejects an unsigned, a wrongly signed, a wrong-network and a foreign-server challenge', () => {
    const v = new ChallengeVerifier(deps);
    const unsigned = buildChallenge(deps, client.publicKey(), 'testnet').transaction;
    expect(() => v.verify(unsigned, 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => v.verify(sign(unsigned, Keypair.random()), 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => v.verify(sign(unsigned, client), 'mainnet')).toThrow(expect.objectContaining({ status: 401 }));
    const foreign = buildChallenge({ ...deps, signing: Keypair.random() }, client.publicKey(), 'testnet').transaction;
    expect(() => v.verify(sign(foreign, client), 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
  });
});
