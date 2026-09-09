'use client';
import { useState } from 'react';
import { download } from '@/lib/sonata';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { FN, FN_COLS, SIM_OPTS, XDR } from '@/components/data';

export default function Functions({ S }) {
  const [mode, setMode] = useState('build');
  const [result, setResult] = useState(null);
  const [signed, setSigned] = useState(false);
  const [ran, setRan] = useState(false);
  const rows = FN.map((f, i) => ({
    num: <S.Numeral index={i + 1} />, fn: f[0], sig: f[1],
    kind: <S.Chip tone={f[2] ? 'inverse' : 'neutral'}>{f[2] ? 'Write' : 'Read'}</S.Chip>
  }));
  return (
    <>
      <ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} />
      <div className="two-col" style={{ marginTop: 24 }}>
        <div>
          <div className="sn-label sn-muted">Function detail · write</div>
          <h2 className="sn-h2" style={{ margin: '14px 0 0' }}>transfer</h2>
          <div className="sn-mono" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>POST /c/CGA4…D4R/tx/transfer</div>
          <div style={{ marginTop: 24 }}>
            <S.KeyValueList rows={[
              { key: 'Kind', value: 'Write' },
              { key: 'Auth', value: 'from must sign', mono: false },
              { key: 'Returns', value: 'void' }
            ]} />
          </div>
          <Label style={{ marginTop: 32 }}>Parameters</Label>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <S.Field label="from" mono hint="Address" defaultValue="GBX7NNM2QP4TL5DJZK6WVRC3HAUXBF29Y8E4Q9" />
            <S.Field label="to" mono hint="Address" defaultValue="GCK2R7V4WPLX3ZQJ86TSMH5NBDYAF7E2KM8P" />
            <S.Field label="amount" mono hint="i128" defaultValue="1250000000" />
          </div>
          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <S.Segmented ariaLabel="Mode" options={SIM_OPTS} value={mode} onChange={(v) => { setMode(v); setResult(null); setSigned(false); }} />
            <S.Button onClick={() => { setResult(mode); setSigned(false); }}>{mode === 'sim' ? 'Simulate' : 'Build unsigned XDR'}</S.Button>
          </div>
          {result === 'sim' && (
            <div>
              <Label style={{ marginTop: 36 }}>Result</Label>
              <div style={{ marginTop: 14 }}>
                <CodeBox>
                  <div>
                    <div className="sn-mono">{'{ "status": "ok", "auth": ["from"] }'}</div>
                    <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 10 }}>Simulated · 42 ms</div>
                  </div>
                </CodeBox>
              </div>
            </div>
          )}
          {result === 'build' && (
            <div>
              <Label style={{ marginTop: 36 }}>Unsigned XDR</Label>
              <div style={{ marginTop: 14 }}>
                <CodeBox right={<CopyButton S={S} text={XDR}>Copy</CopyButton>}>
                  <div className="sn-mono" style={{ fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' }}>{XDR}</div>
                </CodeBox>
              </div>
              <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <S.Button variant="accent" onClick={() => setSigned(true)}>Sign with Freighter</S.Button>
                <S.Button variant="secondary" onClick={() => download('transfer-unsigned.xdr', XDR)}>Download XDR</S.Button>
              </div>
              {signed && (
                <div>
                  <Label style={{ marginTop: 36 }}>After signing</Label>
                  <div style={{ marginTop: 14 }}>
                    <S.KeyValueList rows={[
                      { key: 'Status', value: <S.Chip tone="good">Confirmed</S.Chip> },
                      { key: 'Ledger', value: '48,192,044' },
                      { key: 'Hash', value: 'a3f9…c21e' },
                      { key: 'Fee', value: '0.00001 XLM' }
                    ]} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="sn-label sn-muted">Function detail · read</div>
          <h2 className="sn-h2" style={{ margin: '14px 0 0' }}>balance</h2>
          <div className="sn-mono" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>POST /c/CGA4…D4R/call/balance</div>
          <div style={{ marginTop: 24 }}>
            <S.Field label="id" mono hint="Address" defaultValue="GBX7NNM2QP4TL5DJZK6WVRC3HAUXBF29Y8E4Q9" />
          </div>
          <div style={{ marginTop: 24 }}>
            <S.Button variant="secondary" onClick={() => setRan(true)}>Run</S.Button>
          </div>
          {ran && (
            <div>
              <Label style={{ marginTop: 36 }}>Result</Label>
              <div className="code-box" style={{ marginTop: 14, display: 'block' }}>
                <div className="sn-mono">{'{ "balance": "1250000000" }'}</div>
                <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 10 }}>Simulated · 42 ms</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
