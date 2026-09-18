import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => null, copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/wallet', () => ({ signTransaction: vi.fn().mockResolvedValue('SIGNED') }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { ...(await orig()).contracts, tx: vi.fn(), submit: vi.fn(), call: vi.fn() } }));
import Functions from '@/components/workspace/Functions';
import { SessionProvider } from '@/components/SessionProvider';
import { setSession } from '@/lib/session';
import { contracts, PASSPHRASES } from '@/lib/api';
import * as wallet from '@/lib/wallet';

const S = {
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Field: ({ label, value, onChange }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /></label>,
  Segmented: ({ options, value, onChange }) => <div>{options.map((o) => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>,
  Numeral: () => null, Chip: ({ children }) => <span>{children}</span>, KeyValueList: ({ rows }) => <dl>{rows.map((r) => <div key={r.key}>{r.key}: {typeof r.value === 'string' ? r.value : ''}</div>)}</dl>,
  DataTable: () => null // rt-desktop is rendered alongside rt-mobile in jsdom (no real CSS), so a stub keeps the table mountable
};
const contract = { id: 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP', network: 'testnet', functions: [{ name: 'bump', doc: '', inputs: [], output: 'u32', kind: 'unknown', jsonSchema: { type: 'object', properties: {}, required: [] } }] };
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('Functions: Sign & submit', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  afterEach(cleanup);
  it('labels unknown kinds "Unknown" and hides Sign & submit when anonymous', () => {
    render(<SessionProvider><Functions S={S} contract={contract} id={contract.id} /></SessionProvider>);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Build transaction' }));
    expect(screen.queryByRole('button', { name: 'Sign & submit' })).toBeNull();
  });
  it('signed in: prefills source, builds, signs with the wallet and submits', async () => {
    setSession({ token: 't', address: G, expires_at: new Date(Date.now() + 60_000).toISOString() });
    contracts.tx.mockResolvedValue({ xdr: 'AAAA', fee: '100', auth: [G], ledger: 1, expires_at: new Date().toISOString() });
    contracts.submit.mockResolvedValue({ hash: 'abc123', status: 'success', ledger: 4745473 });
    render(<SessionProvider><Functions S={S} contract={contract} id={contract.id} /></SessionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Build transaction' }));
    await waitFor(() => expect(screen.getByLabelText('source').value).toBe(G));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & submit' }));
    await waitFor(() => expect(contracts.submit).toHaveBeenCalledWith(contract.id, 'SIGNED'));
    expect(wallet.signTransaction).toHaveBeenCalledWith('AAAA', PASSPHRASES.testnet, G);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeTruthy());
    expect(screen.getByText(/4745473/)).toBeTruthy();
  });
  it('a rejected wallet signature keeps the built XDR visible and shows a note', async () => {
    setSession({ token: 't', address: G, expires_at: new Date(Date.now() + 60_000).toISOString() });
    contracts.tx.mockResolvedValue({ xdr: 'AAAA', fee: '100', auth: [G], ledger: 1, expires_at: new Date().toISOString() });
    wallet.signTransaction.mockRejectedValue(Object.assign(new Error('The wallet request was cancelled.'), { name: 'WalletError', code: 'rejected' }));
    render(<SessionProvider><Functions S={S} contract={contract} id={contract.id} /></SessionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Build transaction' }));
    await waitFor(() => expect(screen.getByLabelText('source').value).toBe(G));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & submit' }));
    await waitFor(() => expect(screen.getByText('The wallet request was cancelled.')).toBeTruthy());
    expect(screen.getByText('Unsigned XDR')).toBeTruthy();
    expect(contracts.submit).not.toHaveBeenCalled();
  });
});
