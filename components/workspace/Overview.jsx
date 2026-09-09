'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Label, evRow, ResponsiveTable } from '@/components/ui';
import { EV, EV_COLS, SURFACES, BAR_VALS } from '@/components/data';

export default function Overview({ S }) {
  const router = useRouter();
  const max = Math.max(...BAR_VALS);
  return (
    <>
      <div className="sn-stat-row">
        <S.Stat label="Requests · 24h" value="1,284" note="+18.4% vs yesterday" />
        <S.Stat label="Events indexed" value="4,920" note="since ledger 47,610,002" />
        <S.Stat label="Active addresses · 24h" value="18" note="3 new" />
        <S.Stat label="Volume · 24h" value="42,910" unit="XLM" note="≈ 24,850 USDC" />
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <Label>Generated surfaces</Label>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--sn-ink)' }}>
            {SURFACES.map((s, i) => (
              <Link key={i} className="row-link" href={s.href}
                style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) 24px', gap: '0 16px', alignItems: 'center', padding: '15px 0', borderBottom: '1px solid var(--sn-hairline)' }}>
                <S.Numeral index={i + 1} />
                <div>
                  <div className="sn-body" style={{ fontWeight: 700 }}>{s.name}</div>
                  <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 3 }}>{s.d}</div>
                </div>
                <div className="sn-mono" style={{ fontSize: 16 }}>→</div>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <Label>Transactions per day · last 14 days</Label>
          <div style={{ marginTop: 16 }}>
            <div className="sn-label" style={{ textAlign: 'right', marginBottom: 8 }}>today · 58</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 180, borderBottom: '1px solid var(--sn-ink)' }}>
              {BAR_VALS.map((v, i) => (
                <div key={i} style={{ flex: 1, height: Math.round(v / max * 170), background: i === BAR_VALS.length - 1 ? 'var(--sn-accent)' : 'var(--sn-ink)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <span className="sn-label sn-muted">Aug 27</span>
              <span className="sn-label sn-muted">Sep 9</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Label style={{ marginBottom: 16 }}>Latest events</Label>
        <ResponsiveTable S={S} columns={EV_COLS} rows={EV.slice(0, 3).map(evRow(S))} minWidth={800} />
        <div style={{ marginTop: 12 }}>
          <S.Button variant="text" onClick={() => router.push('/c/history')}>Open history</S.Button>
        </div>
      </div>
    </>
  );
}
