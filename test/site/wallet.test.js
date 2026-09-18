import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as wallet from '@/lib/wallet';

const PUB = 'Public Global Stellar Network ; September 2015';
const TEST = 'Test SDF Network ; September 2015';
const fakeKit = (over = {}) => ({
  authModal: vi.fn().mockResolvedValue({ address: 'GABC' }),
  getAddress: vi.fn().mockResolvedValue({ address: 'GABC' }),
  getNetwork: vi.fn().mockResolvedValue({ network: 'PUBLIC', networkPassphrase: PUB }),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'SIGNED' }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...over
});

describe('wallet', () => {
  beforeEach(() => localStorage.clear());
  it('connects through the auth modal and returns the address', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    expect(await wallet.connect()).toBe('GABC');
    expect(kit.authModal).toHaveBeenCalled();
  });
  it('maps the kit network to ours and falls back to testnet', async () => {
    wallet._setKitForTests(fakeKit());
    expect(await wallet.getNetwork()).toEqual({ network: 'mainnet', networkPassphrase: PUB });
    wallet._setKitForTests(fakeKit({ getNetwork: vi.fn().mockRejectedValue(new Error('no')) }));
    expect(await wallet.getNetwork()).toEqual({ network: 'testnet', networkPassphrase: TEST });
    wallet._setKitForTests(fakeKit({ getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET', networkPassphrase: TEST }) }));
    expect((await wallet.getNetwork()).network).toBe('testnet');
  });
  it('signs with the passphrase and address, returning the signed xdr', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    expect(await wallet.signTransaction('AAAA', TEST, 'GABC')).toBe('SIGNED');
    expect(kit.signTransaction).toHaveBeenCalledWith('AAAA', { networkPassphrase: TEST, address: 'GABC' });
  });
  it('normalises wallet errors', async () => {
    wallet._setKitForTests(fakeKit({ signTransaction: vi.fn().mockRejectedValue(new Error('User declined access')) }));
    await expect(wallet.signTransaction('AAAA', TEST, 'GABC')).rejects.toMatchObject({ name: 'WalletError', code: 'rejected' });
    wallet._setKitForTests(fakeKit({ signTransaction: vi.fn().mockRejectedValue(new Error('Network passphrase mismatch')) }));
    await expect(wallet.signTransaction('AAAA', TEST, 'GABC')).rejects.toMatchObject({ code: 'network' });
    wallet._setKitForTests(fakeKit({ authModal: vi.fn().mockRejectedValue(new Error('Modal closed')) }));
    await expect(wallet.connect()).rejects.toMatchObject({ code: 'rejected' });
  });
  it('disconnect clears the remembered wallet', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    await wallet.connect(); await wallet.disconnect();
    expect(kit.disconnect).toHaveBeenCalled();
    expect(localStorage.getItem('sonata.wallet')).toBeNull();
  });
});
