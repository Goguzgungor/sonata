'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, shortAddr, relTime, mcpToolCount } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';
import NotRegistered from '@/components/NotRegistered';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { mcpConfig } from '@/components/workspace/Mcp';
import { PipelineSteps, STATUS } from '@/components/workspace/Workspace';

const FN_COLS = [
  { key: 'num', header: '', width: '56px' }, { key: 'fn', header: 'Function', width: '150px', strong: true },
  { key: 'sig', header: 'Signature', mono: true }, { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];
const sig = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

function Live({ S, c, router }) {
  const config = mcpConfig(c);
  const rows = c.functions.map((f, i) => ({ num: <S.Numeral index={i + 1} />, fn: f.name, sig: sig(f), kind: <S.Chip tone={f.kind === 'write' ? 'inverse' : 'neutral'}>{f.kind === 'write' ? 'Write' : f.kind === 'read' ? 'Read' : 'Unknown'}</S.Chip> }));
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
        <S.Stat label="MCP tools" value={String(mcpToolCount(c))} />
        <S.Stat label="Types" value={String(c.types.length)} />
        <S.Stat label="Updated" value={relTime(c.updated_at)} />
      </div>
      <div className="two-col">
        <div>
          <Label style={{ marginBottom: 16 }}>About</Label>
          <S.KeyValueList rows={[
            { key: 'Network', value: c.network, mono: false },
            { key: 'Owner', value: c.owner ? shortAddr(c.owner) : 'unclaimed', mono: !!c.owner },
            { key: 'Spec', value: 'SEP-48' },
            { key: 'AI docs', value: <a className="crumb" href={c.urls.llms} target="_blank" rel="noreferrer">llms.txt</a> },
            { key: 'OpenAPI', value: <a className="crumb" href={c.urls.openapi} target="_blank" rel="noreferrer">openapi.json</a> },
            { key: 'Base URL', value: contracts.urls(c.id).base }   // the API's `urls` has no `base`
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

/** Registered but not indexed yet: the real row the API returned (no model, so no functions and no stats to show). */
function Registering({ S, c }) {
  const [tone, label] = STATUS[c.status] || STATUS.queued;
  const failed = c.status === 'failed';
  return (
    <>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{c.name || shortId(c.id)}</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 10, maxWidth: 560 }}>
            {failed ? 'Registration failed, so this contract has no generated API yet.' : 'Registration in progress. The REST API, MCP tools and docs appear here once the pipeline finishes.'}
          </p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <CopyButton S={S} text={c.id}>Copy</CopyButton>
            <S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
            <S.Chip tone={tone}>{label}</S.Chip>
          </div>
        </div>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Pipeline</Label>
        <PipelineSteps S={S} steps={c.steps || []} />
      </div>
      {failed && <div><Link className="crumb" href={`/register?id=${c.id}`}>Try again</Link></div>}
    </>
  );
}

export default function ContractPublic({ id }) {
  const S = useSonataUI();
  const router = useRouter();
  const { data, error, loading, refetch } = useApi(() => contracts.get(id), [id]);
  if (!S) return null;
  const live = data && data.status === 'ready' ? data : null;
  const registering = data && data.status !== 'ready' ? data : null;   // registered, still queued/running/failed
  const notFound = error && error.status === 404;
  const crumb = data ? (data.name || shortId(id)) : shortId(id);
  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/explorer">Explorer</Link> / {crumb}</div>
      <Async S={S} loading={loading} error={notFound ? null : error} onRetry={refetch}>
        {live ? <Live S={S} c={live} router={router} />
          : registering ? <Registering S={S} c={registering} />
          : notFound ? <NotRegistered S={S} id={id} />
          : null}
      </Async>
    </main>
  );
}
