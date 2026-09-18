'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton } from '@/components/ui';
import PreviewBar from '@/components/PreviewBar';
import { XDR } from '@/components/data';
import { flowRequest, flowCurl, flowMcp } from '@/components/flows-data';
import { PUBLIC_CONTRACTS } from '@/components/explorer-data';

const PRE = { margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export default function FlowDetail({ flow: f }) {
  const S = useSonataUI();
  const [state, setState] = useState('idle'); // idle | running | done
  if (!S) return null;
  const contract = PUBLIC_CONTRACTS.find((c) => c.name.toLowerCase().startsWith(f.protocol.split('-')[0]));
  const run = () => { setState('running'); setTimeout(() => setState('done'), 800); };
  return (
    <main className="page">
      <PreviewBar />
      <div className="sn-label sn-muted"><Link className="crumb" href="/flows">Flows</Link> / {f.name}</div>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{f.name}</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 10, maxWidth: 600 }}>{f.d}</p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <S.Chip tone="inverse">{f.intent}</S.Chip>
            <S.Chip>{f.protocol}</S.Chip>
            <S.Chip>{f.kind}</S.Chip>
            <span className="sn-mono sn-muted">{f.slug}</span>
          </div>
        </div>
        <div className="actions">
          <CopyButton S={S} variant="secondary" text={flowMcp(f)}>Copy MCP call</CopyButton>
          <S.Button variant="accent" arrow onClick={run} disabled={state === 'running'}>{state === 'running' ? 'Building…' : state === 'done' ? 'Build again' : 'Build on testnet'}</S.Button>
        </div>
      </div>
      <div className="two-col">
        <div>
          <Label style={{ marginBottom: 16 }}>Inputs · {f.inputs.length}</Label>
          <S.KeyValueList rows={f.inputs.map(([k, t, d]) => ({ key: k + ' · ' + t, value: d, mono: false }))} />
          <div style={{ marginTop: 28 }}>
            <Label style={{ marginBottom: 16 }}>Resolved on-chain</Label>
            <p className="sn-body sn-muted" style={{ margin: 0 }}>Everything not listed above is read from the contract spec or current ledger state when the flow runs: contract addresses, reserves, fees, auth entries and sequence numbers.</p>
          </div>
          {contract && (
            <div style={{ marginTop: 28 }}>
              <Label style={{ marginBottom: 16 }}>Contract</Label>
              <Link className="row-link surface" href={'/explorer/' + contract.id} style={{ borderTop: '1px solid var(--sn-ink)', padding: '16px 0' }}>
                <S.Numeral index={1} />
                <div className="surface__body">
                  <div className="sn-body" style={{ fontWeight: 700 }}>{contract.name}</div>
                  <div className="sn-mono sn-muted">{contract.category} · {contract.net}</div>
                </div>
              </Link>
            </div>
          )}
        </div>
        <div>
          <Label style={{ marginBottom: 16 }}>REST</Label>
          <div className="sn-mono" style={{ marginBottom: 12, overflowWrap: 'anywhere' }}>POST /flows/{f.slug}/build</div>
          <CodeBox right={<CopyButton S={S} text={flowCurl(f)}>Copy</CopyButton>}>
            <pre className="sn-mono" style={PRE}>{flowCurl(f)}</pre>
          </CodeBox>
          <Label style={{ margin: '28px 0 16px' }}>MCP</Label>
          <CodeBox right={<CopyButton S={S} text={flowMcp(f)}>Copy</CopyButton>}>
            <pre className="sn-mono" style={PRE}>{flowMcp(f)}</pre>
          </CodeBox>
          {state === 'done' && (
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                <Label>Unsigned XDR</Label>
                <S.Chip tone="good">Simulated · 61 ms</S.Chip>
              </div>
              <CodeBox right={<CopyButton S={S} text={XDR}>Copy</CopyButton>}>
                <div className="sn-mono" style={{ fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' }}>{XDR}</div>
              </CodeBox>
              <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Sample response. Sign with Freighter and submit from your app, or let your agent hand it to a signer.</div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
