import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/wallet', () => ({
  connect: vi.fn().mockResolvedValue('GABC'),
  getNetwork: vi.fn().mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' }),
  signTransaction: vi.fn().mockResolvedValue('SIGNED'),
  disconnect: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), auth: { challenge: vi.fn().mockResolvedValue({ transaction: 'CHAL', network_passphrase: 'Test SDF Network ; September 2015' }), token: vi.fn().mockResolvedValue({ token: 'tok', address: 'GABC', expires_at: new Date(Date.now() + 60_000).toISOString() }) } }));
import { signIn, signOut } from '@/lib/auth';
import { getSession } from '@/lib/session';
import * as wallet from '@/lib/wallet';
import { auth } from '@/lib/api';

describe('signIn / signOut', () => {
  beforeEach(() => localStorage.clear());
  it('connect → challenge → sign → token → session', async () => {
    const s = await signIn();
    expect(auth.challenge).toHaveBeenCalledWith('GABC', 'testnet');
    expect(wallet.signTransaction).toHaveBeenCalledWith('CHAL', 'Test SDF Network ; September 2015', 'GABC');
    expect(auth.token).toHaveBeenCalledWith('SIGNED', 'testnet');
    expect(s).toMatchObject({ token: 'tok', address: 'GABC' });
    expect(getSession()).toMatchObject({ token: 'tok' });
    signOut();
    expect(getSession()).toBeNull();
    expect(wallet.disconnect).toHaveBeenCalled();
  });
});
