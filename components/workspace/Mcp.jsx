'use client';
import { useState, useEffect } from 'react';
import { contracts, shortId, mcpGlobalConfig, mcpGlobalOneLiner } from '@/lib/api';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';

const COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'tool', header: 'Tool', width: '260px', strong: true },
  { key: 'src', header: 'Source', mono: true },
  { key: 'kind', header: 'Kind', width: '110px' },
  { key: 'on', header: 'Enabled', width: '110px', align: 'right' }
];
const SCOPES = [{ value: 'ro', label: 'Read only' }, { value: 'rw', label: 'Read + write' }];
export const slugOf = (c) => (c.name || shortId(c.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const mcpConfig = (c) => JSON.stringify({ mcpServers: { ['sonata-' + slugOf(c)]: { url: c.urls.mcp, type: 'http' } } }, null, 2);

export default function Mcp({ S, contract: c, id, refetch, isOwner }) {
  const [scope, setScope] = useState(c?.mcp_scope);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setScope(c?.mcp_scope); }, [c?.mcp_scope]);
  if (!c) return null;
  const rw = scope === 'rw';
  const change = async (v) => {
    if (saving || v === scope) return;                 // one PATCH at a time: the control is disabled, this guards stray events
    const prev = scope; setScope(v); setErr(null); setSaving(true);
    try { await contracts.patch(id, { mcp_scope: v }); refetch(); }
    catch (e) { setScope(prev); setErr(e); }
    finally { setSaving(false); }
  };
  const tools = [
    ...c.functions.map((f) => ({ tool: `call_${f.name}`, src: 'contract', write: false, on: true })),
    ...c.functions.map((f) => ({ tool: `build_${f.name}`, src: 'contract', write: true, on: rw })),
    { tool: 'submit_transaction', src: 'contract', write: true, on: rw },
    { tool: 'search_functions', src: 'docs', write: false, on: true },
    { tool: 'get_docs', src: 'docs', write: false, on: true }
  ];
  const rows = tools.map((t, i) => ({
    num: <S.Numeral index={i + 1} />, tool: t.tool, src: t.src,
    kind: <S.Chip tone={t.write ? 'inverse' : 'neutral'}>{t.write ? 'Write' : 'Read'}</S.Chip>,
    on: <S.Chip tone={t.on ? 'good' : 'neutral'}>{t.on ? 'On' : 'Off'}</S.Chip>
  }));
  const config = mcpConfig(c);
  const oneLiner = `claude mcp add --transport http sonata-${slugOf(c)} ${c.urls.mcp}`;
  return (
    <>
      <div>
        <Label>Endpoint</Label>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.urls.mcp}</span>
          <CopyButton S={S} text={c.urls.mcp}>Copy</CopyButton>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        {isOwner ? (
          // the kit's Segmented takes no `disabled` prop, so the wrapper is what blocks input while a PATCH is in flight
          <div aria-busy={saving || undefined} style={saving ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
            <S.Segmented ariaLabel="Scope" options={SCOPES} value={scope} onChange={change} />
          </div>
        ) : (
          <S.Chip tone={rw ? 'inverse' : 'neutral'}>{rw ? 'Read + write' : 'Read only'}</S.Chip>
        )}
        <span className="sn-small sn-muted">
          {!isOwner ? 'Only the wallet that registered this contract can change the scope.' : saving ? 'Saving…' : err ? `Couldn't change scope: ${err.message}` : rw ? 'Write tools are enabled. Agents can build unsigned transactions and submit signed ones.' : 'Write tools stay disabled until you enable them explicitly. Agents never hold keys.'}
        </span>
      </div>
      <div className="sn-small sn-muted">The global endpoint exposes this contract through call / build / submit under the same scope.</div>
      <div>
        <Label style={{ marginBottom: 16 }}>Tools · {tools.filter((t) => t.on).length} enabled</Label>
        <ResponsiveTable S={S} columns={COLS} rows={rows} minWidth={760} />
      </div>
      <div style={{ maxWidth: 976 }}>
        <Label>Connect an agent</Label>
        <div style={{ marginTop: 16 }}>
          <Label style={{ marginBottom: 8 }}>All contracts (recommended)</Label>
          <CodeBox right={<CopyButton S={S} text={mcpGlobalConfig}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{mcpGlobalConfig}</pre>
          </CodeBox>
          <div style={{ marginTop: 12 }}>
            <CodeBox right={<CopyButton S={S} text={mcpGlobalOneLiner}>Copy</CopyButton>}>
              <div className="sn-mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{mcpGlobalOneLiner}</div>
            </CodeBox>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <CopyButton S={S} variant="secondary" text={mcpGlobalConfig}>Claude</CopyButton>
            <CopyButton S={S} variant="secondary" text={mcpGlobalConfig}>Cursor</CopyButton>
            <CopyButton S={S} variant="secondary" text={mcpGlobalConfig}>Codex</CopyButton>
          </div>
        </div>
        <div style={{ marginTop: 32 }}>
          <Label style={{ marginBottom: 8 }}>This contract only</Label>
          <CodeBox right={<CopyButton S={S} text={config}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
          </CodeBox>
          <div style={{ marginTop: 12 }}>
            <CodeBox right={<CopyButton S={S} text={oneLiner}>Copy</CopyButton>}>
              <div className="sn-mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{oneLiner}</div>
            </CodeBox>
          </div>
        </div>
      </div>
    </>
  );
}
