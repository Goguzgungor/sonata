import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Field: ({ label, value, onChange, hint }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /><span>{hint}</span></label>,
  Segmented: () => null, Numeral: () => null, Chip: ({ children }) => <span>{children}</span>
}), copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { register: vi.fn(), status: vi.fn() } }));
import Register from '@/components/screens/Register';
import { SessionProvider } from '@/components/SessionProvider';
import { setSession } from '@/lib/session';
import { signIn } from '@/lib/auth';
import { contracts } from '@/lib/api';

const ID = 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const S = { token: 't', address: 'GOWNER', expires_at: new Date(Date.now() + 60_000).toISOString() };

describe('Register', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  afterEach(cleanup);
  it('anonymous: the primary button connects first, then registers', async () => {
    signIn.mockImplementation(async () => { setSession(S); return S; });
    contracts.register.mockResolvedValue({ id: ID, status: 'queued', steps: [] });
    render(<SessionProvider><Register initialId={ID} /></SessionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet to register' }));
    await waitFor(() => expect(contracts.register).toHaveBeenCalledWith(ID, 'testnet', undefined));
  });
  it('signed in: registers directly and shows not_owner errors', async () => {
    setSession(S);
    contracts.register.mockRejectedValue(Object.assign(new Error('this contract was registered by another wallet'), { error: 'not_owner', status: 403, details: { owner: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' } }));
    render(<SessionProvider><Register initialId={ID} /></SessionProvider>);
    await waitFor(() => screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByText(/registered by another wallet \(GBRP…OX2H\)/)).toBeTruthy());
  });
});
