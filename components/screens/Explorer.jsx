'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label } from '@/components/ui';
import { PUBLIC_CONTRACTS, CATEGORIES, EXPLORER_SORTS, shortId, fmt } from '@/components/explorer-data';

export default function Explorer() {
  const S = useSonataUI();
  const router = useRouter();
  const [sort, setSort] = useState('active');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  if (!S) return null;
  const query = q.trim().toLowerCase();
  const list = PUBLIC_CONTRACTS
    .filter((c) => (cat === 'All' || c.category === cat) && (!query || c.name.toLowerCase().includes(query) || c.id.toLowerCase().includes(query)))
    .filter((c) => sort !== 'verified' || c.verified)
    .sort((a, b) => sort === 'active' ? b.calls - a.calls : sort === 'newest' ? b.added.localeCompare(a.added) : b.updated.localeCompare(a.updated));
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="sn-h1">Contract explorer</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 560 }}>Browse public Soroban contracts indexed by Sonata. Every one has a hosted API, MCP tools and docs you can use without registering.</p>
        </div>
        <span className="sn-label sn-muted">{fmt(PUBLIC_CONTRACTS.length)} contracts · 1,204 indexed</span>
      </div>
      <div className="filters">
        <div className="filters__seg"><S.Segmented ariaLabel="Sort" options={EXPLORER_SORTS} value={sort} onChange={setSort} /></div>
        <div className="filters__addr"><S.Field label="Search" mono placeholder="Name or C…" hint="Name or contract ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="chip-row" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={'sn-chip chip-row__chip' + (cat === c ? ' sn-chip--inverse' : '')} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>{list.length === PUBLIC_CONTRACTS.length ? 'All contracts' : list.length + ' matching'}</Label>
        {list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-small sn-muted">No contracts match. Try another category or search.</span></div>
        ) : (
          <div className="card-grid">
            {list.map((c, i) => (
              <Link key={c.id} className="card" href={'/explorer/' + c.id}>
                <div className="card__top">
                  <S.Numeral index={i + 1} />
                  <div className="card__chips">
                    <S.Chip tone={c.net === 'Mainnet' ? 'inverse' : 'neutral'}>{c.net}</S.Chip>
                    {c.verified ? <S.Chip tone="good">Verified</S.Chip> : <S.Chip tone="neutral">Unverified</S.Chip>}
                  </div>
                </div>
                <div className="sn-h3 card__title">{c.name}</div>
                <div className="sn-mono sn-muted card__id">{shortId(c.id)} · {c.owner}</div>
                <p className="sn-small sn-muted card__desc">{c.d}</p>
                <div className="card__inputs">
                  <div className="sn-label sn-muted">{c.category} · {c.fns} functions</div>
                  <div className="sn-mono card__names">{fmt(c.calls)} calls · updated {c.updated}</div>
                </div>
                <div className="card__foot">
                  <span className="sn-label">Open contract</span>
                  <span className="sn-mono">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <div className="cta-band">
        <div>
          <div className="sn-h3">Your contract is not here?</div>
          <div className="sn-body sn-muted" style={{ marginTop: 6 }}>Register it and Sonata generates the same surfaces in about thirty seconds.</div>
        </div>
        <div className="actions"><S.Button arrow onClick={() => router.push('/register')}>Register a contract</S.Button></div>
      </div>
    </main>
  );
}
