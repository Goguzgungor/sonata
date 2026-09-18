import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({ Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>, Chip: ({ children }) => <span>{children}</span> }), copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
import { SessionProvider } from '@/components/SessionProvider';
import WalletButton from '@/components/WalletButton';
import { setSession } from '@/lib/session';
import { signIn, signOut } from '@/lib/auth';

const mount = () => render(<SessionProvider><WalletButton /></SessionProvider>);

describe('WalletButton', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  afterEach(cleanup);
  it('offers to connect when anonymous and signs in on click', async () => {
    signIn.mockImplementation(async () => { const s = { token: 't', address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ', expires_at: new Date(Date.now() + 60_000).toISOString() }; setSession(s); return s; });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await waitFor(() => expect(screen.getByText('GABC…WXYZ')).toBeTruthy());
  });
  it('shows the address and disconnects', async () => {
    setSession({ token: 't', address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ', expires_at: new Date(Date.now() + 60_000).toISOString() });
    mount();
    await waitFor(() => expect(screen.getByText('GABC…WXYZ')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(signOut).toHaveBeenCalled();
  });
  it('surfaces a wallet error and returns to the connect state', async () => {
    signIn.mockRejectedValue(Object.assign(new Error('The wallet request was cancelled.'), { code: 'rejected' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await waitFor(() => expect(screen.getByText('The wallet request was cancelled.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
  });
});
