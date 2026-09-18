'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime, mcpToolCount } from '@/lib/api';
import { useApi, usePoll } from '@/lib/useApi';
import Async from '@/components/Async';
import NotRegistered from '@/components/NotRegistered';
import { CopyButton } from '@/components/ui';
import { TAB_LABEL } from '@/components/data';
import Overview from './Overview';
import Functions from './Functions';
import Mcp from './Mcp';
import Docs from './Docs';
import History from './History';

export const STATUS = { ready: ['good', 'Indexed'], queued: ['warning', 'Indexing'], running: ['warning', 'Indexing'], failed: ['bad', 'Failed'] };
const STEP = { queued: ['neutral', 'Queued'], running: ['warning', 'Running'], done: ['good', 'Done'], skipped: ['neutral', 'Skipped'], failed: ['bad', 'Failed'] };

export function StepChip({ S, status }) { const [tone, label] = STEP[status] || STEP.queued; return <S.Chip tone={tone}>{label}</S.Chip>; }

export function PipelineSteps({ S, steps }) {
  return (
    <div style={{ borderTop: '1px solid var(--sn-ink)' }}>
      {steps.map((s, i) => (
        <div key={s.name} className="pipe-row">
          <span className="pipe-row__num"><S.Numeral index={i + 1} /></span>
          <div className="sn-body pipe-row__name" style={{ fontWeight: 700 }}>{({ fetch: 'Fetch WASM from network', parse: 'Parse SEP-48 contract spec', generate: 'Generate REST API + MCP + docs', index: 'Index on-chain history' })[s.name] || s.name}</div>
          <div className="sn-mono pipe-row__desc" style={s.status === 'failed' ? { color: 'var(--sn-bad, #b00)' } : undefined}>{s.status === 'failed' ? s.error : s.detail}</div>
          <span className="pipe-row__chip"><StepChip S={S} status={s.status} /></span>
        </div>
      ))}
    </div>
  );
}

function NotReady({ S, id, initial, onReady }) {
  const { data } = usePoll(() => contracts.status(id), { every: 1500, until: (d) => d.status === 'ready' || d.status === 'failed' });
  const st = data || initial;
  useEffect(() => { if (data?.status === 'ready') onReady(); }, [data, onReady]);
  return (
    <div>
      <div className="sn-label">{st.status === 'failed' ? 'Registration failed' : 'Registering…'}</div>
      <div style={{ marginTop: 16 }}><PipelineSteps S={S} steps={st.steps || []} /></div>
      {st.status === 'failed' && <div style={{ marginTop: 20 }}><Link className="crumb" href={`/register?id=${id}`}>Try again</Link></div>}
    </div>
  );
}

export default function Workspace({ id, tab }) {
  const S = useSonataUI();
  const router = useRouter();
  const t = TAB_LABEL[tab] ? tab : 'overview';
  const { data: contract, error, loading, refetch } = useApi(() => contracts.get(id), [id]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [renameErr, setRenameErr] = useState(null);
  const [savingName, setSavingName] = useState(false);
  const tabsRef = useRef(null);
  useEffect(() => {
    const strip = tabsRef.current && tabsRef.current.querySelector('.sn-tabs');
    const active = strip && strip.querySelector('[aria-selected="true"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
  }, [S, t, contract]);
  if (!S) return null;

  const title = contract?.name || shortId(id);
  const fns = contract?.functions?.length || 0;
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'functions', label: 'Functions', count: fns },
    { id: 'mcp', label: 'MCP', count: contract?.functions ? mcpToolCount(contract) : 0 }, { id: 'docs', label: 'Docs' }, { id: 'history', label: 'History' }
  ];
  const Body = t === 'functions' ? Functions : t === 'mcp' ? Mcp : t === 'docs' ? Docs : t === 'history' ? History : Overview;
  const [tone, label] = STATUS[contract?.status] || STATUS.queued;

  const saveName = async () => {
    setRenameErr(null); setSavingName(true);
    try { await contracts.patch(id, { name: name.trim() || null }); setRenaming(false); refetch(); }
    catch (e) { setRenameErr(e); }
    finally { setSavingName(false); }
  };
  const openRename = () => { setName(contract.name || ''); setRenameErr(null); setRenaming(true); };
  const cancelRename = () => { setRenameErr(null); setRenaming(false); };

  if (error?.status === 404) return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/contracts">Contracts</Link> / {shortId(id)}</div>
      <NotRegistered S={S} id={id} />
    </main>
  );

  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/contracts">Contracts</Link> / {title}{t !== 'overview' ? ' / ' + TAB_LABEL[t] : ''}</div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {contract && contract.status !== 'ready' ? (
          <NotReady S={S} id={id} initial={contract} onReady={refetch} />
        ) : contract && (
          <>
            <div className="page-head" style={{ gap: 24 }}>
              <div style={{ minWidth: 0, maxWidth: '100%' }}>
                {renaming ? (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <S.Field label="Name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!renameErr} hint={renameErr ? renameErr.message : 'Shown in lists and docs'} />
                    <S.Button disabled={savingName} onClick={saveName}>{savingName ? 'Saving…' : 'Save'}</S.Button>
                    <S.Button variant="text" onClick={cancelRename}>Cancel</S.Button>
                  </div>
                ) : (
                  <h1 className="sn-h1" style={{ margin: 0, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    {title}
                    <S.Button variant="text" size="sm" onClick={openRename}>Rename</S.Button>
                  </h1>
                )}
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{id}</span>
                  <CopyButton S={S} text={id}>Copy</CopyButton>
                  <S.Chip tone={contract.network === 'mainnet' ? 'inverse' : 'neutral'}>{contract.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
                  <S.Chip tone={tone}>{label} {relTime(contract.updated_at)}</S.Chip>
                </div>
              </div>
              <div className="actions">
                <CopyButton S={S} variant="primary" arrow text={contract.urls.mcp}>Copy MCP URL</CopyButton>
              </div>
            </div>
            <div ref={tabsRef} style={{ minWidth: 0 }}>
              <S.Tabs items={tabs} active={t} onChange={(next) => router.push(`/c/${id}/${next}`)} />
            </div>
            {/* keyed by id: switching contracts remounts the tab body instead of carrying its state over */}
            <Body key={id} S={S} contract={contract} id={id} refetch={refetch} />
          </>
        )}
      </Async>
    </main>
  );
}
