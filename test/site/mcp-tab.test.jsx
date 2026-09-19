import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => null, copyText: vi.fn(), download: vi.fn() }));
import Mcp from '@/components/workspace/Mcp';
import { mcpGlobalUrl, mcpGlobalOneLiner } from '@/lib/api';

const S = {
  Numeral: () => null,
  Chip: ({ children }) => <span>{children}</span>,
  Segmented: ({ options, value, onChange }) => <div>{options.map((o) => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>,
  Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
  DataTable: () => null
};

const c = {
  id: 'CID',
  mcp_scope: 'ro',
  functions: [
    { name: 'add', inputs: [], output: 'i128' },
    { name: 'bump', inputs: [], output: 'u32' }
  ],
  urls: { mcp: 'https://api.test/c/CID/mcp' }
};

describe('Mcp tab', () => {
  afterEach(cleanup);
  it('shows both the global (recommended) config and the per-contract-only config', () => {
    render(<Mcp S={S} contract={c} id={c.id} refetch={() => {}} isOwner={false} />);
    expect(screen.getByText('All contracts (recommended)')).toBeTruthy();
    expect(screen.getByText('This contract only')).toBeTruthy();
    expect(screen.getAllByText((t) => t.includes(mcpGlobalUrl)).length).toBeGreaterThan(0);
    expect(screen.getByText(mcpGlobalOneLiner)).toBeTruthy();
    expect(screen.getAllByText((t) => t.includes(c.urls.mcp)).length).toBeGreaterThan(0);
    expect(screen.getByText('The global endpoint exposes this contract through call / build / submit under the same scope.')).toBeTruthy();
  });
  it('lists get_events among the tools, enabled regardless of scope', () => {
    render(<Mcp S={S} contract={c} id={c.id} refetch={() => {}} isOwner={false} />);
    expect(screen.getByText('get_events')).toBeTruthy();
    expect(screen.getByText('Tools · 5 enabled')).toBeTruthy(); // 2 call_* + search_functions + get_events + get_docs
  });
});
