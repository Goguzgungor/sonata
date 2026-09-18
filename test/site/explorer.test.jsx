import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({
  Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
  Field: ({ label, value, onChange }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /></label>,
  Segmented: ({ options, value, onChange }) => <div>{options.map((o) => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>,
  Numeral: () => null, Chip: ({ children }) => <span>{children}</span>
}), copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { ...(await orig()).contracts, list: vi.fn() } }));
import Explorer from '@/components/screens/Explorer';
import { contracts } from '@/lib/api';

const rows = [
  { id: 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH', name: 'Soroswap Router', network: 'mainnet', status: 'ready', fns: 20, owner: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', created_at: '2026-09-18T16:00:00Z', updated_at: '2026-09-18T16:00:00Z' },
  { id: 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP', name: 'e2e fixture', network: 'testnet', status: 'ready', fns: 15, owner: null, created_at: '2026-09-18T15:00:00Z', updated_at: '2026-09-18T15:00:00Z' },
  { id: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', name: null, network: 'testnet', status: 'failed', fns: 0, owner: null, created_at: '2026-09-18T14:00:00Z', updated_at: '2026-09-18T14:00:00Z' }
];

describe('Explorer', () => {
  it('lists ready contracts from the API, filters by network and search', async () => {
    contracts.list.mockResolvedValue(rows);
    render(<Explorer />);
    await waitFor(() => screen.getByText('Soroswap Router'));
    expect(screen.getByText('e2e fixture')).toBeTruthy();
    expect(screen.queryByText(/CDLZ/)).toBeNull();                       // failed rows are not listed
    fireEvent.click(screen.getByRole('button', { name: 'Mainnet' }));
    expect(screen.queryByText('e2e fixture')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'fixture' } });
    expect(screen.queryByText('Soroswap Router')).toBeNull();
    expect(screen.getByText('e2e fixture')).toBeTruthy();
  });
  it('shows an empty state when nothing is registered', async () => {
    contracts.list.mockResolvedValue([]);
    render(<Explorer />);
    await waitFor(() => screen.getByText('No contracts registered yet.'));
  });
});
