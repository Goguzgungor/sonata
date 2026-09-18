'use client';
import { useState } from 'react';
import { download } from '@/lib/sonata';
import { Label, evRow, ResponsiveTable } from '@/components/ui';
import PreviewBar from '@/components/PreviewBar';
import { EV, EV_COLS, ADDR_EV, ADDR_COLS, HIST_OPTS } from '@/components/data';

export default function History({ S }) {
  const [type, setType] = useState('all');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const filtered = EV.filter((e) =>
    (type === 'all' || e[1] === type) && (!query || e[2].toLowerCase().includes(query.toLowerCase())));
  const visible = showAll ? filtered : filtered.slice(0, 6);
  const csv = 'time,event,decoded_call,ledger,status\n' + ADDR_EV.map((e) =>
    [e[0], e[1], '"' + e[2] + '"', e[3].replace(/,/g, ''), e[4] ? 'success' : 'reverted'].join(',')).join('\n');
  const json = JSON.stringify(ADDR_EV.map((e) =>
    ({ time: e[0], event: e[1], call: e[2], ledger: e[3], status: e[4] ? 'success' : 'reverted' })), null, 2);
  return (
    <>
      <PreviewBar />
      <div className="filters">
        <div className="filters__seg">
          <S.Segmented ariaLabel="Event type" options={HIST_OPTS} value={type} onChange={(v) => { setType(v); setShowAll(false); }} />
        </div>
        <div className="filters__addr">
          <S.Field label="Address" mono placeholder="G…" hint="Filters decoded calls" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="filters__dates">
          <div className="filters__date"><S.Field label="From" mono defaultValue="2026-08-01" /></div>
          <div className="filters__date"><S.Field label="To" mono defaultValue="2026-09-09" /></div>
        </div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Events" value="4,920" />
        <S.Stat label="Daily transactions" value="58" />
        <S.Stat label="Active addresses" value="18" />
        <S.Stat label="Volume" value="42,910" unit="XLM" />
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Events</Label>
        {filtered.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}>
            <span className="sn-small sn-muted">No events match the filters.</span>
          </div>
        ) : (
          <ResponsiveTable S={S} columns={EV_COLS} rows={visible.map(evRow(S))} minWidth={800} />
        )}
        {!showAll && filtered.length > 6 && (
          <div style={{ marginTop: 12 }}>
            <S.Button variant="text" onClick={() => setShowAll(true)}>Load more</S.Button>
          </div>
        )}
      </div>
      <div className="two-col" style={{ marginTop: 16 }}>
        <div>
          <Label style={{ marginBottom: 16 }}>Address activity · GBX7…4Q9</Label>
          <S.KeyValueList rows={[
            { key: 'First seen', value: '2026-03-18' },
            { key: 'Last seen', value: '2m ago' },
            { key: 'Interactions', value: '212' },
            { key: 'Volume', value: '8,420 XLM' }
          ]} />
          <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <S.Button variant="secondary" onClick={() => download('gbx7-activity.csv', csv, 'text/csv')}>Export CSV</S.Button>
            <S.Button variant="secondary" onClick={() => download('gbx7-activity.json', json, 'application/json')}>Export JSON</S.Button>
          </div>
        </div>
        <div>
          <Label style={{ marginBottom: 16 }}>Events · GBX7…4Q9</Label>
          <ResponsiveTable S={S} columns={ADDR_COLS} rows={ADDR_EV.map(evRow(S))} minWidth={480} />
        </div>
      </div>
    </>
  );
}
