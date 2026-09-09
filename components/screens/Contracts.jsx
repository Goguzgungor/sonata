'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { CONTRACTS } from '@/components/data';

export default function Contracts() {
  const S = useSonataUI();
  const router = useRouter();
  if (!S) return null;
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div className="page-head__title">
          <h1 className="sn-h1" style={{ margin: 0 }}>My contracts</h1>
          <span className="sn-label sn-muted">3 registered</span>
        </div>
        <div className="actions">
          <S.Button arrow onClick={() => router.push('/register')}>Add a contract</S.Button>
        </div>
      </div>
      <div className="card-grid">
        {CONTRACTS.map((c, i) => (
          <Link key={i} className="card" href="/c/overview">
            <div className="card__top">
              <S.Numeral index={i + 1} />
              <div className="card__chips">
                <S.Chip tone={c.netTone}>{c.net}</S.Chip>
                <S.Chip tone={c.stTone}>{c.st}</S.Chip>
              </div>
            </div>
            <div className="sn-h3 card__title">{c.name}</div>
            <div className="sn-mono sn-muted card__id">{c.id}</div>
            <div className="card__desc" />
            <div className="card__inputs">
              <div className="sn-label sn-muted">Activity</div>
              <div className="sn-mono card__names">{c.calls} · indexed {c.when}</div>
            </div>
            <div className="card__foot">
              <span className="sn-label">Open workspace</span>
              <span className="sn-mono">→</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
