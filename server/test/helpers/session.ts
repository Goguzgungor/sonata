import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { PASSPHRASES } from '../../src/config.js';

/** Runs the real challenge → sign → token flow against an app under test. */
export async function signInAs(app: FastifyInstance, kp: Keypair, network: 'testnet' | 'mainnet' = 'testnet') {
  const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network } });
  if (ch.statusCode !== 200) throw new Error(`challenge: ${ch.body}`);
  const tx = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES[network]); tx.sign(kp);
  const tok = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: tx.toXDR(), network } });
  if (tok.statusCode !== 200) throw new Error(`token: ${tok.body}`);
  return { token: tok.json().token as string, address: kp.publicKey() };
}
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
