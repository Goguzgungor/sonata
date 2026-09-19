'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { contracts, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useDebounced } from '@/lib/useDebounced';
import { download } from '@/lib/sonata';
import { CodeBox, ResponsiveTable } from '@/components/ui';

const ADDR_RE = /^[GC][A-Z2-7]{55}$/;
const TYPE_RE = /^[A-Za-z0-9_]{1,32}$/;   // same symbol shape the server's normaliseQuery accepts
const DEBOUNCE_MS = 400;
const BAD_TONE = { color: 'var(--sn-bad, #b00)' };

/** Distinct G…/C… strings found anywhere inside a decoded value, recursively. */
function collectAddresses(v, set) {
  if (typeof v === 'string') { if (ADDR_RE.test(v)) set.add(v); return; }
  if (Array.isArray(v)) { for (const x of v) collectAddresses(x, set); return; }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) collectAddresses(x, set); }
}

/** `key=value, …` for a plain decoded object; JSON otherwise (arrays, scalars, null). */
const decodedSummary = (data) => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    return entries.length ? entries.map(([k, v]) => `${k}=${v && typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '{}';
  }
  return JSON.stringify(data);
};

const shortHash = (h) => (h ? h.slice(0, 6) + '…' + h.slice(-4) : '—');

const COLS = [
  { key: 'time', header: 'Time', width: '110px' },
  { key: 'event', header: 'Event', width: '140px', strong: true },
  { key: 'data', header: 'Decoded', mono: true },
  { key: 'ledger', header: 'Ledger', width: '90px', align: 'right' },
  { key: 'tx', header: 'Tx', width: '130px', mono: true },
  { key: 'status', header: 'Status', width: '90px', align: 'right' }
];

export default function History({ S, contract: c, id }) {
  const declared = c?.events || [];
  const [type, setType] = useState(() => (declared.length ? 'all' : ''));
  const [address, setAddress] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [seenData, setSeenData] = useState(null);
  const [list, setList] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreErr, setMoreErr] = useState(null);
  const gen = useRef(0);         // bumped (in an effect, not during render — see below) whenever the filter set produces a fresh first page; loadMore ignores a response from a stale generation
  const moreCtrl = useRef(null); // AbortController for an in-flight "Load more" request

  // Free-text / date inputs are debounced before joining the query, and address/type are further
  // gated by validity, so a partial value in progress never fires a live RPC round trip per keystroke
  // (review finding I5). The Segmented control (declared events) bypasses all of this — `type` there
  // changes only on a click, not a keystroke, so it stays immediate.
  const debouncedAddress = useDebounced(address, DEBOUNCE_MS);
  const debouncedType = useDebounced(type, DEBOUNCE_MS);
  const debouncedFrom = useDebounced(from, DEBOUNCE_MS);
  const debouncedTo = useDebounced(to, DEBOUNCE_MS);

  const addressTrimmed = debouncedAddress.trim();
  const addressIncomplete = address.trim() !== '' && !ADDR_RE.test(address.trim());
  const effectiveAddress = ADDR_RE.test(addressTrimmed) ? addressTrimmed : undefined;
  const effectiveType = declared.length > 0
    ? (type && type !== 'all' ? type : undefined)
    : (TYPE_RE.test(debouncedType) ? debouncedType : undefined);
  const typeDep = declared.length > 0 ? type : debouncedType;   // Segmented path keys off `type` directly (immediate); free-text keys off the debounced value

  const filters = () => ({
    type: effectiveType,
    address: effectiveAddress,
    from: debouncedFrom ? new Date(debouncedFrom).toISOString() : undefined,
    to: debouncedTo ? new Date(debouncedTo).toISOString() : undefined
  });

  const { data, error, loading } = useApi(
    (signal) => contracts.events(id, { ...filters(), limit: 50 }, { signal }),
    [id, typeDep, effectiveAddress, debouncedFrom, debouncedTo]
  );

  // A fresh first page (new data reference, from the filters changing or a refetch) resets the
  // accumulated rows and invalidates any in-flight "Load more" for the previous filter set.
  // Adjusted during render (not a useEffect) so the retention banner — which reads `data`
  // directly — never paints a frame ahead of `list`. `gen` itself is bumped separately below, in a
  // layout effect keyed on `data`, so nothing mutates a ref during render (review finding M7); a
  // layout effect (not a passive one) still runs synchronously in the same commit, before the browser
  // can paint or any pending network response's microtask can run, so loadMore's staleness check
  // below never observes a commit whose gen bump hasn't landed yet.
  if (data !== seenData) {
    setSeenData(data);
    setList(data ? data.events : []);
    setCursor(data ? data.page.cursor : null);
    setExpanded(new Set());
    setMoreErr(null);
    setLoadingMore(false);
  }
  useLayoutEffect(() => { gen.current += 1; }, [data]);

  // Cancels an in-flight "Load more" request when the filters change again or the tab unmounts.
  useEffect(() => () => moreCtrl.current?.abort(), [id, typeDep, effectiveAddress, debouncedFrom, debouncedTo]);

  const stats = useMemo(() => {
    const types = new Set(); const addrs = new Set();
    for (const e of list) {
      if (e.event) types.add(e.event);
      collectAddresses(e.topics, addrs);
      collectAddresses(e.data, addrs);
    }
    return { count: list.length, types: types.size, addrs: addrs.size };
  }, [list]);

  const loadMore = async () => {
    if (!cursor) return;
    const g = gen.current;
    const ctrl = new AbortController();
    moreCtrl.current = ctrl;
    setLoadingMore(true); setMoreErr(null);
    try {
      const next = await contracts.events(id, { ...filters(), limit: 50, cursor }, { signal: ctrl.signal });
      if (gen.current !== g) return; // the filters changed while this request was in flight; its page belongs to a stale query
      setList((l) => [...l, ...next.events]);
      setCursor(next.page.cursor);
    } catch (e) {
      if (gen.current !== g || e?.name === 'AbortError') return;
      setMoreErr(e);
    } finally {
      if (gen.current === g) setLoadingMore(false);
    }
  };

  const toggleRaw = (rowId) => setExpanded((s) => { const n = new Set(s); if (n.has(rowId)) n.delete(rowId); else n.add(rowId); return n; });
  const downloadCsv = () => window.open(contracts.eventsCsvUrl(id, { ...filters(), limit: 200 }), '_blank', 'noopener');
  const downloadJson = () => download(`${id}-events.json`, JSON.stringify(list, null, 2), 'application/json');

  if (!c) return null;

  const rows = list.map((e) => ({
    time: <span title={e.closed_at}>{relTime(e.closed_at)}</span>,
    event: e.event || '—',
    data: (
      <div>
        <div className="sn-mono" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodedSummary(e.data)}</div>
        <button type="button" className="crumb" aria-pressed={expanded.has(e.id)} style={{ background: 'none', border: 0, padding: 0, marginTop: 4, font: 'inherit', cursor: 'pointer' }} onClick={() => toggleRaw(e.id)}>
          {expanded.has(e.id) ? 'Hide raw' : 'Raw'}
        </button>
        {expanded.has(e.id) && (
          <div style={{ marginTop: 8 }}>
            <CodeBox><pre className="sn-mono" style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ topics: e.topics, data: e.data, raw: e.raw }, null, 2)}</pre></CodeBox>
          </div>
        )}
      </div>
    ),
    ledger: e.ledger,
    tx: <a className="crumb" href={e.explorer_url} target="_blank" rel="noreferrer">{shortHash(e.tx_hash)}</a>,
    status: <S.Chip tone={e.successful ? 'good' : 'failed'}>{e.successful ? 'ok' : 'failed'}</S.Chip>
  }));

  return (
    <div>
      <div className="filters" style={{ borderTop: '1px solid var(--sn-ink)', paddingTop: 24 }}>
        {declared.length > 0 ? (
          <div className="filters__seg">
            <S.Segmented ariaLabel="Event type" options={[{ value: 'all', label: 'All' }, ...declared.map((e) => ({ value: e.name, label: e.name }))]} value={type} onChange={setType} />
          </div>
        ) : (
          <S.Field label="Type" hint="event name or symbol · optional" value={type} onChange={(e) => setType(e.target.value)} />
        )}
        <div className="filters__addr">
          <S.Field label="Address" hint="G… or C… · optional" value={address} onChange={(e) => setAddress(e.target.value)} />
          {addressIncomplete && <div className="sn-small sn-muted" style={{ marginTop: 4 }}>Enter a full G… or C… address</div>}
        </div>
        <div className="filters__dates">
          <S.Field className="filters__date" label="From" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <S.Field className="filters__date" label="To" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {data?.retention && (
        <div className="sn-small sn-muted" style={{ marginTop: 16 }}>
          History comes from the network&apos;s RPC and covers the last ~7 days (ledgers {data.retention.oldest_ledger}–{data.retention.latest_ledger}).
        </div>
      )}

      {loading && <div className="sn-small sn-muted" style={{ marginTop: 24 }}>Loading…</div>}

      {error && (
        <div className="sn-small" style={{ ...BAD_TONE, marginTop: 24 }}>
          <div>{error.message}</div>
          {error.error === 'range_out_of_retention' && <div>Try a range inside the retention window.</div>}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="sn-stat-row" style={{ marginTop: 24 }}>
            <S.Stat label="Events (loaded)" value={String(stats.count)} />
            <S.Stat label="Event types" value={String(stats.types)} />
            <S.Stat label="Addresses (loaded)" value={String(stats.addrs)} />
          </div>

          {list.length === 0 ? (
            <div className="sn-body" style={{ marginTop: 32 }}>No events in this window.</div>
          ) : (
            <div style={{ marginTop: 24 }}>
              <ResponsiveTable S={S} columns={COLS} rows={rows} minWidth={860} />
            </div>
          )}

          {moreErr && <div className="sn-small" style={{ ...BAD_TONE, marginTop: 12 }}>{moreErr.message}</div>}

          <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {cursor && <S.Button variant="secondary" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Loading…' : 'Load more'}</S.Button>}
            <S.Button variant="text" onClick={downloadCsv}>Download CSV</S.Button>
            <S.Button variant="text" onClick={downloadJson}>Download JSON</S.Button>
          </div>
        </>
      )}
    </div>
  );
}
