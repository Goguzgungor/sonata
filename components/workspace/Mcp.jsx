'use client';
import { useState } from 'react';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { TL, TOOL_COLS, MCP_OPTS, MCP_URL, MCP_CONFIG } from '@/components/data';

export default function Mcp({ S }) {
  const [scope, setScope] = useState('ro');
  const rows = TL.map((t, i) => {
    const on = t[2] ? scope === 'rw' : true;
    return {
      num: <S.Numeral index={i + 1} />, tool: t[0], src: t[1],
      kind: <S.Chip tone={t[2] ? 'inverse' : 'neutral'}>{t[2] ? 'Write' : 'Read'}</S.Chip>,
      on: <S.Chip tone={on ? 'good' : 'neutral'}>{on ? 'On' : 'Off'}</S.Chip>
    };
  });
  return (
    <>
      <div>
        <Label>Endpoint</Label>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{MCP_URL}</span>
          <CopyButton S={S} text={MCP_URL}>Copy</CopyButton>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <S.Segmented ariaLabel="Scope" options={MCP_OPTS} value={scope} onChange={setScope} />
        <span className="sn-small sn-muted">
          {scope === 'ro' ? 'Write tools stay disabled until you enable them explicitly.' : 'Write tools are enabled. Agents can build and submit transactions.'}
        </span>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Tools</Label>
        <ResponsiveTable S={S} columns={TOOL_COLS} rows={rows} minWidth={760} />
      </div>
      <div style={{ maxWidth: 976 }}>
        <Label>Connect an agent</Label>
        <div style={{ marginTop: 16 }}>
          <CodeBox right={<CopyButton S={S} text={MCP_CONFIG}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{MCP_CONFIG}</pre>
          </CodeBox>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <CopyButton S={S} variant="secondary" text={MCP_CONFIG}>Claude</CopyButton>
          <CopyButton S={S} variant="secondary" text={MCP_CONFIG}>Cursor</CopyButton>
          <CopyButton S={S} variant="secondary" text={MCP_CONFIG}>Codex</CopyButton>
        </div>
      </div>
    </>
  );
}
