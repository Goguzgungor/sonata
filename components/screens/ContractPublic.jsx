'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { FN_COLS, API_URL } from '@/components/data';
import { PUBLIC_FNS, shortId, fmt } from '@/components/explorer-data';
import { FLOWS } from '@/components/flows-data';

export default function ContractPublic({ contract: c }) {
  const S = useSonataUI();
  const router = useRouter();
  if (!S) return null;
  const base = API_URL + '/c/' + shortId(c.id);
  const mcpUrl = base + '/mcp';
  const mcpConfig = JSON.stringify({ mcpServers: { ['sonata-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')]: { url: mcpUrl, type: 'http' } } }, null, 2);
  const rows = PUBLIC_FNS.slice(0, c.fns).map((f, i) => ({
    num: <S.Numeral index={i + 1} />, fn: f[0], sig: f[1],
    kind: <S.Chip tone={f[2] ? 'inverse' : 'neutral'}>{f[2] ? 'Write' : 'Read'}</S.Chip>
  }));
  const flows = FLOWS.filter((f) => c.name.toLowerCase().startsWith(f.protocol.split('-')[0]));
  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/explorer">Explorer</Link> / {c.name}</div>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{c.name}</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 10, maxWidth: 560 }}>{c.d}</p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <CopyButton S={S} text={c.id}>Copy</CopyButton>
            <S.Chip tone={c.net === 'Mainnet' ? 'inverse' : 'neutral'}>{c.net}</S.Chip>
            {c.verified && <S.Chip tone="good">Verified</S.Chip>}
          </div>
        </div>
        <div className="actions">
          <S.Button variant="secondary" onClick={() => router.push('/register')}>Register to your workspace</S.Button>
          <CopyButton S={S} variant="primary" arrow text={mcpUrl}>Copy MCP URL</CopyButton>
        </div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Calls · 30d" value={fmt(c.calls)} />
        <S.Stat label="Functions" value={String(c.fns)} />
        <S.Stat label="MCP tools" value={String(c.tools)} />
        <S.Stat label="Updated" value={new Date(c.updated + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} note={'added ' + c.added} />
      </div>
      <div className="two-col">
        <div>
          <Label style={{ marginBottom: 16 }}>About</Label>
          <S.KeyValueList rows={[
            { key: 'Category', value: c.category, mono: false },
            { key: 'Owner', value: c.owner },
            { key: 'Spec', value: 'SEP-48' },
            { key: 'AI docs', value: c.docs ? 'llms.txt available' : 'Not generated yet', mono: false },
            { key: 'Base URL', value: base }
          ]} />
        </div>
        <div>
          <Label style={{ marginBottom: 16 }}>Connect an agent</Label>
          <CodeBox right={<CopyButton S={S} text={mcpConfig}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{mcpConfig}</pre>
          </CodeBox>
          <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Read tools work without a key. Write tools need a registered workspace.</div>
        </div>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Functions · {c.fns}</Label>
        <ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} />
        {c.fns > PUBLIC_FNS.length && <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Showing {PUBLIC_FNS.length} of {c.fns}. Register the contract to browse and call every function.</div>}
      </div>
      {flows.length > 0 && (
        <div>
          <Label style={{ marginBottom: 16 }}>Flows using this contract</Label>
          <div style={{ borderTop: '1px solid var(--sn-ink)' }}>
            {flows.map((f, i) => (
              <Link key={f.slug} className="row-link surface" href={'/flows/' + f.slug} style={{ padding: '16px 0' }}>
                <S.Numeral index={i + 1} />
                <div className="surface__body">
                  <div className="sn-body" style={{ fontWeight: 700 }}>{f.name}</div>
                  <div className="sn-mono sn-muted">{f.inputs.length} inputs · {f.intent}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
