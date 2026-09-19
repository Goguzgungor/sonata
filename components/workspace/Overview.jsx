'use client';
import Link from 'next/link';
import { Label } from '@/components/ui';
import { relTime, mcpToolCount } from '@/lib/api';
import { expertUrl } from '@/lib/expert';

export default function Overview({ S, contract: c, id }) {
  if (!c) return null;
  const fns = c.functions.length;
  const rw = c.mcp_scope === 'rw';
  const surfaces = [
    { name: 'REST API', d: `${fns} functions · /call · /tx`, href: `/c/${id}/functions` },
    { name: 'MCP server', d: `${mcpToolCount(c)} tools · ${rw ? 'read + write' : 'read-only by default'}`, href: `/c/${id}/mcp` },
    { name: 'Docs', d: 'llms.txt · OpenAPI 3.1', href: `/c/${id}/docs` },
    { name: 'History', d: 'decoded events · last ~7 days · CSV export', href: `/c/${id}/history` }
  ];
  return (
    <>
      <div className="sn-stat-row">
        <S.Stat label="Functions" value={String(fns)} />
        <S.Stat label="Types" value={String(c.types.length)} />
        <S.Stat label="Errors" value={String(c.errors.length)} />
        <S.Stat label="Events" value={String(c.events.length)} />
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <Label>Generated surfaces</Label>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--sn-ink)' }}>
            {surfaces.map((s, i) => (
              <Link key={s.name} className="row-link" href={s.href}
                style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) 24px', gap: '0 16px', alignItems: 'center', padding: '15px 0', borderBottom: '1px solid var(--sn-hairline)' }}>
                <S.Numeral index={i + 1} />
                <div>
                  <div className="sn-body" style={{ fontWeight: 700 }}>{s.name}</div>
                  <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 3 }}>{s.d}</div>
                </div>
                <div className="sn-mono" style={{ fontSize: 16 }}>→</div>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <Label>Contract</Label>
          <div style={{ marginTop: 16 }}>
            <S.KeyValueList rows={[
              { key: 'Network', value: c.network, mono: false },
              { key: 'Type', value: c.sac ? 'Stellar Asset Contract (SEP-41 token)' : 'Soroban WASM contract', mono: false },
              { key: 'Contract ID', value: <a className="crumb" href={expertUrl(c.network, 'contract', c.id)} target="_blank" rel="noreferrer">{c.id}</a> },
              { key: 'WASM hash', value: c.sac ? 'built-in spec' : c.wasmHash.slice(0, 12) + '…' },
              { key: 'Registered', value: relTime(c.created_at), mono: false },
              { key: 'Status', value: c.status, mono: false },
              { key: 'MCP scope', value: rw ? 'read + write' : 'read-only', mono: false },
              { key: 'OpenAPI', value: <a className="crumb" href={c.urls.openapi} target="_blank" rel="noreferrer">openapi.json</a> }
            ]} />
          </div>
        </div>
      </div>
    </>
  );
}
