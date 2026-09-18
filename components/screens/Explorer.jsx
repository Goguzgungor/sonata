'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, CopyButton } from '@/components/ui';
import { contracts, shortId, shortAddr, relTime, mcpGlobalOneLiner } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';

const NETS = [{ value: 'all', label: 'All' }, { value: 'testnet', label: 'Testnet' }, { value: 'mainnet', label: 'Mainnet' }];
const SORTS = [{ value: 'updated', label: 'Recently updated' }, { value: 'name', label: 'Name' }];
const label = (c) => c.name || shortId(c.id);

export default function Explorer() {
  const S = useSonataUI();
  const router = useRouter();
  const [net, setNet] = useState('all');
  const [sort, setSort] = useState('updated');
  const [q, setQ] = useState('');
  const { data, error, loading, refetch } = useApi((signal) => contracts.list({ signal }), []);
  if (!S) return null;
  const query = q.trim().toLowerCase();
  const all = (data || []).filter((c) => c.status === 'ready');
  const list = all
    .filter((c) => (net === 'all' || c.network === net) && (!query || label(c).toLowerCase().includes(query) || c.id.toLowerCase().includes(query)))
    .sort((a, b) => (sort === 'name' ? label(a).localeCompare(label(b)) : b.updated_at.localeCompare(a.updated_at)));
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="sn-h1">Contract explorer</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 560 }}>Every Soroban contract registered with Sonata. Each one has a hosted REST API, MCP tools and docs you can use without registering anything yourself.</p>
        </div>
        <span className="sn-label sn-muted">{data ? `${all.length} contracts` : ''}</span>
      </div>
      <div className="cta-band">
        <div>
          <div className="sn-h3">Connect an agent</div>
          <div className="sn-mono sn-muted" style={{ marginTop: 6, overflowWrap: 'anywhere' }}>{mcpGlobalOneLiner}</div>
        </div>
        <div className="actions"><CopyButton S={S} variant="secondary" text={mcpGlobalOneLiner}>Copy</CopyButton></div>
      </div>
      <div className="filters">
        <div className="filters__seg"><S.Segmented ariaLabel="Network" options={NETS} value={net} onChange={setNet} /></div>
        <div className="filters__seg"><S.Segmented ariaLabel="Sort" options={SORTS} value={sort} onChange={setSort} /></div>
        <div className="filters__addr"><S.Field label="Search" mono placeholder="Name or C…" hint="Name or contract ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {all.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-body" style={{ fontWeight: 700 }}>No contracts registered yet.</span></div>
        ) : list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-small sn-muted">No contracts match. Try another network or search.</span></div>
        ) : (
          <div>
            <Label style={{ marginBottom: 16 }}>{list.length === all.length ? 'All contracts' : list.length + ' matching'}</Label>
            <div className="card-grid">
              {list.map((c, i) => (
                <Link key={c.id} className="card" href={'/explorer/' + c.id}>
                  <div className="card__top">
                    <S.Numeral index={i + 1} />
                    <div className="card__chips"><S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip></div>
                  </div>
                  <div className="sn-h3 card__title">{label(c)}</div>
                  <div className="sn-mono sn-muted card__id">{c.id}</div>
                  <div className="card__desc" />
                  <div className="card__inputs">
                    <div className="sn-label sn-muted">{c.fns} functions{c.owner ? ` · by ${shortAddr(c.owner)}` : ''}</div>
                    <div className="sn-mono card__names">updated {relTime(c.updated_at)}</div>
                  </div>
                  <div className="card__foot"><span className="sn-label">Open contract</span><span className="sn-mono">→</span></div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Async>
      <div className="cta-band">
        <div>
          <div className="sn-h3">Your contract is not here?</div>
          <div className="sn-body sn-muted" style={{ marginTop: 6 }}>Connect a wallet and register it — Sonata generates the API, MCP tools and docs in about thirty seconds.</div>
        </div>
        <div className="actions"><S.Button arrow onClick={() => router.push('/register')}>Register a contract</S.Button></div>
      </div>
    </main>
  );
}
