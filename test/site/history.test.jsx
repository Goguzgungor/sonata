import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => null, copyText: vi.fn(), download: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, contracts: { ...m.contracts, events: vi.fn() } };
});
import History from '@/components/workspace/History';
import { contracts, ApiError } from '@/lib/api';
import { download } from '@/lib/sonata';

const S = {
  Numeral: () => null,
  Chip: ({ children, tone }) => <span data-tone={tone}>{children}</span>,
  Segmented: ({ options, value, onChange, ariaLabel }) => (
    <div role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => <button key={o.value} type="button" aria-checked={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  ),
  Field: ({ label, value, onChange, type }) => <label>{label}<input aria-label={label} type={type} value={value || ''} onChange={onChange} /></label>,
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Stat: ({ label, value }) => <div>{label}: {value}</div>,
  KeyValueList: ({ rows }) => <dl>{rows.map((r) => <div key={r.key}>{r.key}: {r.value}</div>)}</dl>,
  DataTable: () => null // rt-desktop renders alongside rt-mobile in jsdom; the stub keeps rt-mobile the only content source
};

const contract = {
  id: 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP',
  network: 'testnet',
  events: [{ name: 'Pinged', doc: '', params: [] }, { name: 'Bumped', doc: '', params: [] }]
};

const page1 = {
  events: [
    { id: 'e1', ledger: 100, closed_at: '2026-09-18T12:00:00Z', tx_hash: 'abcdef00112233445566778899aabbccddeeff', successful: true, event: 'Pinged', topics: ['Pinged', 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY'], data: { who: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXY' }, raw: { topic: ['x1'], value: 'y1' }, explorer_url: 'https://stellar.expert/explorer/testnet/tx/abcdef00112233445566778899aabbccddeeff' },
    { id: 'e2', ledger: 101, closed_at: '2026-09-18T12:05:00Z', tx_hash: '112233445566778899aabbccddeeff001122334', successful: false, event: 'Bumped', topics: ['Bumped'], data: { n: 7 }, raw: { topic: ['x2'], value: 'y2' }, explorer_url: 'https://stellar.expert/explorer/testnet/tx/112233445566778899aabbccddeeff001122334' }
  ],
  page: { cursor: 'CUR1', limit: 50, from_ledger: 90, to_ledger: 101 },
  retention: { oldest_ledger: 80, latest_ledger: 200, latest_ledger_close_time: '2026-09-18T13:00:00Z', note: 'RPC history covers the last ~7 days' }
};

const emptyPage = { events: [], page: { cursor: null, limit: 50, from_ledger: 1, to_ledger: 2 }, retention: { oldest_ledger: 1, latest_ledger: 2, latest_ledger_close_time: '2026-09-18T00:00:00Z', note: '' } };

/** A promise this test controls the settlement of, to simulate two requests racing. */
function defer() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('History tab', () => {
  afterEach(cleanup);

  it('renders events from the resolved page, the retention banner and the loaded-count tile', async () => {
    contracts.events.mockResolvedValue(page1);
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByText('Events (loaded): 2')).toBeTruthy());
    expect(screen.getAllByText('Pinged').length).toBeGreaterThan(1); // Segmented option + table cell
    expect(screen.getAllByText('Bumped').length).toBeGreaterThan(1);
    expect(screen.getByText(/n=7/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /112233…2334/ });
    expect(link.getAttribute('href')).toBe(page1.events[1].explorer_url);
    expect(screen.getByText(/covers the last ~7 days/)).toBeTruthy();
    expect(screen.getByText('Events (loaded): 2')).toBeTruthy();
    // page1.events[1] (Bumped) is successful: false
    expect(screen.getByText('failed').getAttribute('data-tone')).toBe('failed');
  });

  it('shows the empty state for a page with no events', async () => {
    contracts.events.mockResolvedValue(emptyPage);
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByText('No events in this window.')).toBeTruthy());
  });

  it('Load more appends the next page using the cursor, and hides once cursor is null', async () => {
    contracts.events.mockResolvedValueOnce(page1).mockResolvedValueOnce({
      events: [{ id: 'e3', ledger: 102, closed_at: '2026-09-18T12:10:00Z', tx_hash: 'aa11bb22cc33dd44ee55ff00aa11bb22cc33dd4', successful: true, event: 'Pinged', topics: ['Pinged'], data: {}, raw: { topic: [], value: '' }, explorer_url: 'https://stellar.expert/explorer/testnet/tx/aa11bb22cc33dd44ee55ff00aa11bb22cc33dd4' }],
      page: { cursor: null, limit: 50, from_ledger: 90, to_ledger: 102 },
      retention: page1.retention
    });
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(2));
    const [, params] = contracts.events.mock.calls[1];
    expect(params.cursor).toBe('CUR1');
    await waitFor(() => expect(screen.getByText('Events (loaded): 3')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('choosing an event type via the Segmented control re-queries with that type', async () => {
    contracts.events.mockResolvedValue(page1);
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Pinged' }));
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(2));
    const [, params] = contracts.events.mock.calls[1];
    expect(params.type).toBe('Pinged');
  });

  it('Download JSON exports the loaded rows', async () => {
    contracts.events.mockResolvedValue(page1);
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download JSON' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    expect(download).toHaveBeenCalledWith(`${contract.id}-events.json`, expect.any(String), 'application/json');
  });

  it('ignores a Load more response that resolves after the filters changed mid-flight', async () => {
    const loadMoreDefer = defer();
    const newFirstDefer = defer();
    contracts.events
      .mockResolvedValueOnce(page1)                        // initial load (type = all)
      .mockImplementationOnce(() => loadMoreDefer.promise)  // Load more — left pending
      .mockImplementationOnce(() => newFirstDefer.promise); // first page for the new type filter

    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load more' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Bumped' })); // switches the type filter mid-flight
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(3));

    const newFirstPage = {
      events: [{ id: 'e9', ledger: 500, closed_at: '2026-09-18T14:00:00Z', tx_hash: 'ff00ff00ff00ff00ff00ff00ff00ff00ff00ff0', successful: true, event: 'Bumped', topics: ['Bumped'], data: { n: 1 }, raw: { topic: [], value: '' }, explorer_url: 'https://stellar.expert/explorer/testnet/tx/ff00ff00ff00ff00ff00ff00ff00ff00ff00ff0' }],
      page: { cursor: 'CUR-NEW', limit: 50, from_ledger: 90, to_ledger: 500 },
      retention: page1.retention
    };
    newFirstDefer.resolve(newFirstPage);
    await waitFor(() => expect(screen.getByText('Events (loaded): 1')).toBeTruthy());

    // The earlier Load more (for the old "all" filter) resolves now — it must be dropped.
    loadMoreDefer.resolve({
      events: [{ id: 'stale', ledger: 999, closed_at: '2026-09-18T15:00:00Z', tx_hash: '0000000000000000000000000000000000000', successful: true, event: 'Pinged', topics: ['Pinged'], data: {}, raw: { topic: [], value: '' }, explorer_url: 'https://stellar.expert/explorer/testnet/tx/0000000000000000000000000000000000000' }],
      page: { cursor: 'STALE-CURSOR', limit: 50, from_ledger: 90, to_ledger: 999 }
    });
    await new Promise((r) => setTimeout(r, 10)); // flush the (now irrelevant) stale promise's microtasks
    expect(screen.getByText('Events (loaded): 1')).toBeTruthy(); // unchanged by the stale response
    expect(screen.queryByText('999')).toBeNull(); // the stale page's ledger never made it into the list

    // The cursor must be the new page's, not the stale one's.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(4));
    const [, params] = contracts.events.mock.calls[3];
    expect(params.cursor).toBe('CUR-NEW');
  });

  it('a range_out_of_retention error shows the message and a hint', async () => {
    contracts.events.mockRejectedValue(new ApiError(400, 'range_out_of_retention', 'from is before the retention window'));
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(screen.getByText('from is before the retention window')).toBeTruthy());
    expect(screen.getByText(/Try a range inside the retention window\./)).toBeTruthy();
  });

  it('typing a partial address sends no request and shows a hint, not a query per keystroke (review finding I5)', async () => {
    contracts.events.mockResolvedValue(page1);
    render(<History S={S} contract={contract} id={contract.id} />);
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(1));

    // A partial address (not yet 56 chars) never joins the query, even after the debounce window.
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'GABCDEF' } });
    await waitFor(() => expect(screen.getByText('Enter a full G… or C… address')).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(contracts.events).toHaveBeenCalledTimes(1); // still just the initial load — no request for the partial address

    // Completing the address to a valid, full-length G… key joins the query once the debounce settles.
    const fullAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: fullAddress } });
    await waitFor(() => expect(contracts.events).toHaveBeenCalledTimes(2));
    const [, params] = contracts.events.mock.calls[1];
    expect(params.address).toBe(fullAddress);
  });
});
