import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({
  StaffLines: () => null,
  Numeral: () => null,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>
}), copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const o = await orig();
  return { ...o, contracts: { ...o.contracts, list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) }, health: vi.fn().mockResolvedValue({ networks: {} }) };
});
import Welcome from '@/components/screens/Welcome';
import { mcpGlobalOneLiner } from '@/lib/api';

describe('Home', () => {
  afterEach(cleanup);
  it('the "AI agent setup" block renders the global MCP one-liner', async () => {
    render(<Welcome />);
    await waitFor(() => screen.getByText('AI agent setup'));
    expect(screen.getAllByText((t) => t.includes(mcpGlobalOneLiner)).length).toBeGreaterThan(0);
  });
});
