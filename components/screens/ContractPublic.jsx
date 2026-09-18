'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';
import PreviewBar from '@/components/PreviewBar';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { mcpConfig } from '@/components/workspace/Mcp';
import { PUBLIC_FNS, fmt } from '@/components/explorer-data';

const FN_COLS = [
  { key: 'num', header: '', width: '56px' }, { key: 'fn', header: 'Function', width: '150px', strong: true },
  { key: 'sig', header: 'Signature', mono: true }, { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];
const sig = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

function Live({ S, c, router }) {
  const config = mcpConfig(c);
  const rows = c.functions.map((f, i) => ({ num: <S.Numeral index={i + 1} />, fn: f.name, sig: sig(f), kind: <S.Chip tone={f.kind === 'write' ? 'inverse' : 'neutral'}>{f.kind === 'write' ? 'Write' : f.kind === 'read' ? 'Read' : '—'}</S.Chip> }));
  const name = c.name || shortId(c.id);
  return (
    <>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{name}</h1>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <CopyButton S={S} text={c.id}>Copy</CopyButton>
            <S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
          </div>
        </div>
        <div className="actions">
          <S.Button variant="secondary" onClick={() => router.push(`/c/${c.id}/overview`)}>Open workspace</S.Button>
          <CopyButton S={S} variant="primary" arrow text={c.urls.mcp}>Copy MCP URL</CopyButton>
        </div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Functions" value={String(c.functions.length)} />
        <S.Stat label="MCP tools" value={String(c.mcp_scope === 'rw' ? c.functions.length * 2 + 3 : c.functions.length + 2)} />
        <S.Stat label="Types" value={String(c.types.length)} />
        <S.Stat label="Updated" value={relTime(c.updated_at)} />
      </div>
      <div className="two-col">
        <div>
          <Label style={{ marginBottom: 16 }}>About</Label>
          <S.KeyValueList rows={[
            { key: 'Network', value: c.network, mono: false }, { key: 'Spec', value: 'SEP-48' },
            { key: 'AI docs', value: <a className="crumb" href={c.urls.llms} target="_blank" rel="noreferrer">llms.txt</a> },
            { key: 'OpenAPI', value: <a className="crumb" href={c.urls.openapi} target="_blank" rel="noreferrer">openapi.json</a> },
            { key: 'Base URL', value: c.urls.base || contracts.urls(c.id).base }
          ]} />
        </div>
        <div>
          <Label style={{ marginBottom: 16 }}>Connect an agent</Label>
          <CodeBox right={<CopyButton S={S} text={config}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
          </CodeBox>
          <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Read tools work without a key. Write tools are enabled per contract from its workspace.</div>
        </div>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Functions · {c.functions.length}</Label>
        <ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} />
      </div>
    </>
  );
}

function Demo({ S, c, router }) {   // the previous demo rendering, unchanged in substance
  const base = `${contracts.urls(c.id).base}`;
  const rows = PUBLIC_FNS.slice(0, c.fns).map((f, i) => ({ num: <S.Numeral index={i + 1} />, fn: f[0], sig: f[1], kind: <S.Chip tone={f[2] ? 'inverse' : 'neutral'}>{f[2] ? 'Write' : 'Read'}</S.Chip> }));
  return (
    <>
      <PreviewBar />
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{c.name}</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 10, maxWidth: 560 }}>{c.d}</p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <S.Chip tone={c.net === 'Mainnet' ? 'inverse' : 'neutral'}>{c.net}</S.Chip>
            {c.verified && <S.Chip tone="good">Verified</S.Chip>}
          </div>
        </div>
        <div className="actions"><S.Button variant="secondary" onClick={() => router.push(`/register?id=${c.id}`)}>Register to your workspace</S.Button></div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Calls · 30d" value={fmt(c.calls)} /><S.Stat label="Functions" value={String(c.fns)} /><S.Stat label="MCP tools" value={String(c.tools)} /><S.Stat label="Category" value={c.category} />
      </div>
      <div><Label style={{ marginBottom: 16 }}>Functions · {c.fns}</Label><ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} /></div>
      <div className="sn-small sn-muted">Base URL {base} · sample listing; register the contract to get its real API.</div>
    </>
  );
}

export default function ContractPublic({ id, demo }) {
  const S = useSonataUI();
  const router = useRouter();
  const { data, error, loading, refetch } = useApi(() => contracts.get(id), [id]);
  if (!S) return null;
  const live = data && data.status === 'ready' ? data : null;
  const notFound = error && error.status === 404;
  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/explorer">Explorer</Link> / {live ? (live.name || shortId(id)) : demo ? demo.name : shortId(id)}</div>
      {live ? <Live S={S} c={live} router={router} />
        : notFound && demo ? <Demo S={S} c={demo} router={router} />
        : notFound ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}>
            <div className="sn-body" style={{ fontWeight: 700 }}>This contract isn't registered with Sonata.</div>
            <div style={{ marginTop: 16 }}><S.Button arrow onClick={() => router.push(`/register?id=${id}`)}>Register it</S.Button></div>
          </div>
        ) : <Async S={S} loading={loading} error={error} onRetry={refetch}>{data && <Demo S={S} c={demo || { id, name: shortId(id), d: 'Registration in progress.', net: 'Testnet', fns: 0, tools: 0, calls: 0, category: '—' }} router={router} />}</Async>}
    </main>
  );
}
