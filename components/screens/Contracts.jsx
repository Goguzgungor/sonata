'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';

const STATUS = { ready: ['good', 'Indexed'], queued: ['warning', 'Indexing'], running: ['warning', 'Indexing'], failed: ['bad', 'Failed'] };

export default function Contracts() {
  const S = useSonataUI();
  const router = useRouter();
  const { data, error, loading, refetch } = useApi(() => contracts.list(), []);
  if (!S) return null;
  const list = data || [];
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div className="page-head__title">
          <h1 className="sn-h1" style={{ margin: 0 }}>My contracts</h1>
          <span className="sn-label sn-muted">{data ? `${list.length} registered` : ''}</span>
        </div>
        <div className="actions"><S.Button arrow onClick={() => router.push('/register')}>Add a contract</S.Button></div>
      </div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '32px 0' }}>
            <div className="sn-body" style={{ fontWeight: 700 }}>No contracts yet</div>
            <div className="sn-small sn-muted" style={{ marginTop: 8 }}>Register a Soroban contract to get its API, MCP tools and docs.</div>
          </div>
        ) : (
          <div className="card-grid">
            {list.map((c, i) => {
              const [tone, label] = STATUS[c.status] || STATUS.queued;
              const href = c.status === 'failed' ? `/register?id=${c.id}` : `/c/${c.id}/overview`;
              return (
                <Link key={c.id} className="card" href={href}>
                  <div className="card__top">
                    <S.Numeral index={i + 1} />
                    <div className="card__chips">
                      <S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
                      <S.Chip tone={tone}>{label}</S.Chip>
                    </div>
                  </div>
                  <div className="sn-h3 card__title">{c.name || shortId(c.id)}</div>
                  <div className="sn-mono sn-muted card__id">{c.id}</div>
                  <div className="card__desc" />
                  <div className="card__inputs">
                    <div className="sn-label sn-muted">Surface</div>
                    <div className="sn-mono card__names">{c.fns} functions · updated {relTime(c.updated_at)}</div>
                  </div>
                  <div className="card__foot"><span className="sn-label">{c.status === 'failed' ? 'Retry registration' : 'Open workspace'}</span><span className="sn-mono">→</span></div>
                </Link>
              );
            })}
          </div>
        )}
      </Async>
    </main>
  );
}
