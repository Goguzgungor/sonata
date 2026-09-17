import { Address, xdr } from '@stellar/stellar-sdk';

/** Addresses that must sign, from simulation auth entries. stellar-sdk 17 XDR is plain-object style. */
export function authAddresses(entries: xdr.SorobanAuthorizationEntry[], source: string): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const c = e.credentials;
    const addr = c.type === 'sorobanCredentialsAddress' ? Address.fromScAddress(c.address.address).toString() : source;
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}
