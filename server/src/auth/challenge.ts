import { Keypair, StrKey, WebAuth } from '@stellar/stellar-sdk';
import { PASSPHRASES } from '../config.js';
import type { Network } from '../types.js';
import { ApiError, badRequest } from '../errors.js';

export const CHALLENGE_TTL_S = 300;
export type ChallengeDeps = { signing: Keypair; homeDomain: string; webAuthDomain: string };

/** SEP-10 challenge: a never-submitted transaction the wallet signs to prove it holds `address`. */
export function buildChallenge(d: ChallengeDeps, address: string, network: Network): { transaction: string; networkPassphrase: string } {
  if (!StrKey.isValidEd25519PublicKey(address)) throw badRequest('invalid_args', 'address must be a G… ed25519 public key', { path: 'address' });
  const networkPassphrase = PASSPHRASES[network];
  return { transaction: WebAuth.buildChallengeTx(d.signing, address, d.homeDomain, CHALLENGE_TTL_S, networkPassphrase, d.webAuthDomain), networkPassphrase };
}

const rejected = (why: string) => new ApiError(401, 'invalid_challenge', `challenge rejected: ${why}`);

export class ChallengeVerifier {
  /** tx hash (hex) → expiry (ms); a signed challenge is good for one token only. */
  private used = new Map<string, number>();
  constructor(private d: ChallengeDeps) {}

  verify(signedXdr: string, network: Network, now = Date.now()): string {
    const passphrase = PASSPHRASES[network]; const server = this.d.signing.publicKey();
    let clientAccountID: string; let hash: string;
    try {
      const r = WebAuth.readChallengeTx(signedXdr, server, passphrase, this.d.homeDomain, this.d.webAuthDomain);
      clientAccountID = r.clientAccountID; hash = Buffer.from(r.tx.hash()).toString('hex');
      const signers = WebAuth.verifyChallengeTxSigners(signedXdr, server, passphrase, [clientAccountID], this.d.homeDomain, this.d.webAuthDomain);
      if (!signers.includes(clientAccountID)) throw new Error('not signed by the client account');
    } catch (e) { throw rejected((e as Error).message); }
    for (const [h, exp] of this.used) if (exp <= now) this.used.delete(h);
    if (this.used.has(hash)) throw rejected('already used');
    this.used.set(hash, now + CHALLENGE_TTL_S * 1000);
    return clientAccountID;
  }
}
