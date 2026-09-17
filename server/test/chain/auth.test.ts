import { describe, it, expect } from 'vitest';
import { xdr, Address } from '@stellar/stellar-sdk';
import { authAddresses } from '../../src/chain/auth.js';

const G1 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

// stellar-sdk 17.1's xdr.Int64 rejects `new xdr.Int64(0)` (int64 values are
// native bigints now); construct the nonce via `fromString` instead. See
// task-6-report.md for the `node -e` probe that established this.
function addressEntry(g: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(g).toScAddress(), nonce: xdr.Int64.fromString('0'), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid()
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address(G2).toScAddress(), functionName: 'x', args: []
      })), subInvocations: []
    })
  });
}
const sourceEntry = (): xdr.SorobanAuthorizationEntry => new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: addressEntry(G1).rootInvocation
});

describe('authAddresses', () => {
  it('lists address credentials and substitutes the source, de-duplicated', () => {
    expect(authAddresses([addressEntry(G1), sourceEntry(), addressEntry(G1)], G2)).toEqual([G1, G2]);
  });
  it('is empty with no entries', () => { expect(authAddresses([], G1)).toEqual([]); });
});
