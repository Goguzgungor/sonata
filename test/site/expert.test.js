import { describe, it, expect } from 'vitest';
import { expertUrl } from '@/lib/expert';

const C = 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
describe('expertUrl', () => {
  it('maps networks and kinds', () => {
    expect(expertUrl('mainnet', 'contract', C)).toBe(`https://stellar.expert/explorer/public/contract/${C}`);
    expect(expertUrl('testnet', 'account', 'GABC')).toBe('https://stellar.expert/explorer/testnet/account/GABC');
    expect(expertUrl('testnet', 'tx', 'abc123')).toBe('https://stellar.expert/explorer/testnet/tx/abc123');
  });
  it('rejects unknown kinds and encodes the value', () => {
    expect(() => expertUrl('testnet', 'ledger', '1')).toThrow(RangeError);
    expect(expertUrl('testnet', 'tx', 'a/b')).toBe('https://stellar.expert/explorer/testnet/tx/a%2Fb');
  });
});
