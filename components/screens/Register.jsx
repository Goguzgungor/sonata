'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label } from '@/components/ui';
import { CONTRACT_ID, NET_OPTS, PIPE } from '@/components/data';

export default function Register() {
  const S = useSonataUI();
  const router = useRouter();
  const [addr, setAddr] = useState(CONTRACT_ID);
  const [net, setNet] = useState('testnet');
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!running) return;
    const ts = [700, 1500, 2400].map((t, i) => setTimeout(() => setPhase(i + 1), t));
    return () => ts.forEach(clearTimeout);
  }, [running, run]);
  if (!S) return null;
  const stepChip = (i) =>
    i < phase ? <S.Chip tone="good">Done</S.Chip>
    : i === phase && running ? <S.Chip tone="warning">Running</S.Chip>
    : <S.Chip tone="neutral">Queued</S.Chip>;
  return (
    <main className="page" style={{ maxWidth: 976, gap: 0 }}>
      <h1 className="sn-h1" style={{ margin: 0 }}>Register contract</h1>
      <div className="sn-body sn-muted" style={{ marginTop: 14 }}>Paste a Soroban contract address to generate its API, MCP tools and indexed history.</div>
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <S.Field label="Contract address" mono action="Paste" hint="56 characters, starts with C"
          value={addr} onChange={(e) => setAddr(e.target.value)}
          onAction={() => {
            if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then((t) => { if (t) setAddr(t.trim()); }).catch(() => {});
          }} />
        <div className="seg-wrap" style={{ alignSelf: 'flex-start' }}>
          <S.Segmented ariaLabel="Network" options={NET_OPTS} value={net} onChange={setNet} />
        </div>
        <div className="actions">
          <S.Button arrow onClick={() => { setPhase(0); setRunning(true); setRun((r) => r + 1); }}>
            {running && phase < 3 ? 'Generating…' : 'Generate'}
          </S.Button>
          <S.Button variant="secondary" onClick={() => router.push('/contracts')}>Cancel</S.Button>
        </div>
      </div>
      {running && (
        <div>
          <Label style={{ marginTop: 56 }}>Pipeline</Label>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--sn-ink)' }}>
            {PIPE.map((s, i) => (
              <div key={i} className="pipe-row">
                <span className="pipe-row__num"><S.Numeral index={i + 1} /></span>
                <div className="sn-body pipe-row__name" style={{ fontWeight: 700 }}>{s.name}</div>
                <div className="sn-mono pipe-row__desc">{i <= phase ? s.d : ''}</div>
                <span className="pipe-row__chip">{stepChip(i)}</span>
              </div>
            ))}
          </div>
          {phase >= 3 && (
            <div style={{ marginTop: 32 }}>
              <S.Button arrow onClick={() => router.push('/c/overview')}>Open contract workspace</S.Button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
