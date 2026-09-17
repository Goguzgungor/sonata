import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Addresses that must sign, from simulation auth entries. stellar-sdk 17 XDR is plain-object style.
 *
 * `SorobanCredentials` is a 4-way union (soroban-credentials.d.ts): every address-credential
 * arm — `sorobanCredentialsAddress` (v1), `sorobanCredentialsAddressV2`, and
 * `sorobanCredentialsAddressWithDelegates` — means "this address must sign"; simulation with
 * `useUpgradedAuth` (the default) returns v2, so v1-only handling silently misreports those
 * entries as the source account. Only `sorobanCredentialsSourceAccount` substitutes `source`.
 */
export function authAddresses(entries: xdr.SorobanAuthorizationEntry[], source: string): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const c = e.credentials;
    let addr: string;
    if (c.type === 'sorobanCredentialsAddress') addr = Address.fromScAddress(c.address.address).toString();
    else if (c.type === 'sorobanCredentialsAddressV2') addr = Address.fromScAddress(c.addressV2.address).toString();
    else if (c.type === 'sorobanCredentialsAddressWithDelegates') addr = Address.fromScAddress(c.addressWithDelegates.addressCredentials.address).toString();
    else addr = source;
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}
