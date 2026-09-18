import { describe, it, expect } from 'vitest';
import { xdr, Address } from '@stellar/stellar-sdk';
import { authAddresses } from '../../src/chain/auth.js';

const G1 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

// stellar-sdk 17.1's xdr.Int64 rejects `new xdr.Int64(0)` (int64 values are
// native bigints now); construct the nonce via `fromString` instead. See
// task-6-report.md for the `node -e` probe that established this.
const rootInvocation = () => new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
    contractAddress: new Address(G2).toScAddress(), functionName: 'x', args: []
  })), subInvocations: []
});
const addressCredentials = (g: string) => new xdr.SorobanAddressCredentials({
  address: new Address(g).toScAddress(), nonce: xdr.Int64.fromString('0'), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid()
});
function addressEntry(g: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials(g)),
    rootInvocation: rootInvocation()
  });
}
// simulateTransaction's default useUpgradedAuth:true returns this arm for recorded auth —
// authAddresses must treat it the same as the v1 `address` arm (Finding 1).
function addressV2Entry(g: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials(g)),
    rootInvocation: rootInvocation()
  });
}
function addressWithDelegatesEntry(g: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new xdr.SorobanAddressCredentialsWithDelegates({
      addressCredentials: addressCredentials(g), delegates: []
    })),
    rootInvocation: rootInvocation()
  });
}
const sourceEntry = (): xdr.SorobanAuthorizationEntry => new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: rootInvocation()
});

describe('authAddresses', () => {
  it('lists address credentials and substitutes the source, de-duplicated', () => {
    expect(authAddresses([addressEntry(G1), sourceEntry(), addressEntry(G1)], G2)).toEqual([G1, G2]);
  });
  it('is empty with no entries', () => { expect(authAddresses([], G1)).toEqual([]); });
  it('treats sorobanCredentialsAddressV2 the same as v1 address credentials', () => {
    expect(authAddresses([addressV2Entry(G1), sourceEntry()], G2)).toEqual([G1, G2]);
  });
  it('treats sorobanCredentialsAddressWithDelegates the same as v1 address credentials', () => {
    expect(authAddresses([addressWithDelegatesEntry(G1), sourceEntry()], G2)).toEqual([G1, G2]);
  });
});
