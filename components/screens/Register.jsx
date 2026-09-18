'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, isContractId } from '@/lib/api';
import { usePoll } from '@/lib/useApi';
import { Label } from '@/components/ui';
import { PipelineSteps } from '@/components/workspace/Workspace';
import { NET_OPTS } from '@/components/data';

const DONE = (d) => d.status === 'ready' || d.status === 'failed';

export default function Register({ initialId = '' }) {
  const S = useSonataUI();
  const router = useRouter();
  const [addr, setAddr] = useState(initialId);
  const [name, setName] = useState('');
  const [net, setNet] = useState('testnet');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [job, setJob] = useState(null);                 // { id, steps } from the 202
  const poll = usePoll(() => contracts.status(job.id), { every: 1500, until: DONE, enabled: !!job });
  const st = poll.data || job;
  if (!S) return null;
  const valid = isContractId(addr.trim());

  const generate = async () => {
    setSubmitErr(null); setSubmitting(true); setJob(null);
    try { const r = await contracts.register(addr.trim(), net, name.trim() || undefined); setJob({ id: r.id, status: r.status, steps: r.steps }); }
    catch (e) { setSubmitErr(e); }
    finally { setSubmitting(false); }
  };

  const fieldHint = submitErr ? submitErr.message : '56 characters, starts with C';
  return (
    <main className="page" style={{ maxWidth: 976, gap: 0 }}>
      <h1 className="sn-h1" style={{ margin: 0 }}>Register contract</h1>
      <div className="sn-body sn-muted" style={{ marginTop: 14 }}>Paste a Soroban contract address to generate its API, MCP tools and docs.</div>
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <S.Field label="Contract address" mono action="Paste" hint={fieldHint} invalid={!!submitErr || (addr.length > 0 && !valid)}
          value={addr} onChange={(e) => { setAddr(e.target.value); setSubmitErr(null); }}
          onAction={() => { if (navigator.clipboard?.readText) navigator.clipboard.readText().then((t) => { if (t) setAddr(t.trim()); }).catch(() => {}); }} />
        <S.Field label="Name (optional)" hint="Shown in lists and generated docs" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="seg-wrap" style={{ alignSelf: 'flex-start' }}>
          <S.Segmented ariaLabel="Network" options={NET_OPTS} value={net} onChange={(v) => { setNet(v); setSubmitErr(null); }} />
        </div>
        <div className="actions">
          <S.Button arrow disabled={!valid || submitting} onClick={generate}>{submitting ? 'Submitting…' : 'Generate'}</S.Button>
          <S.Button variant="secondary" onClick={() => router.push('/contracts')}>Cancel</S.Button>
        </div>
        {submitErr && submitErr.error === 'network_not_configured' && (
          <div className="sn-small sn-muted">Mainnet isn't enabled on this server yet — register on Testnet, or contact the operator.</div>
        )}
      </div>
      {st && (
        <div>
          <Label style={{ marginTop: 56 }}>Pipeline</Label>
          <div style={{ marginTop: 16 }}><PipelineSteps S={S} steps={st.steps || []} /></div>
          {poll.error && <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Status check failed ({poll.error.error}); retrying…</div>}
          {st.status === 'ready' && (
            <div style={{ marginTop: 32 }}><S.Button arrow onClick={() => router.push(`/c/${job.id}/overview`)}>Open contract workspace</S.Button></div>
          )}
          {st.status === 'failed' && (
            <div style={{ marginTop: 32, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sn-small">{st.error || 'Registration failed.'}</span>
              <S.Button variant="secondary" disabled={submitting} onClick={generate}>Try again</S.Button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
