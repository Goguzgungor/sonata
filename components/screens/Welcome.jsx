'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton } from '@/components/ui';
import PreviewBar from '@/components/PreviewBar';
import { WELCOME_ROWS } from '@/components/data';
import { HOME_STATS, HOME_STEPS, HOME_SURFACES, HOME_CURL, HOME_MCP } from '@/components/home-data';

const PRE = { margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

export default function Welcome() {
  const S = useSonataUI();
  const router = useRouter();
  if (!S) return null;
  return (
    <main className="home">
      <PreviewBar />
      {/* Hero: full-width staff score, then copy left + surfaces right */}
      <section className="home-section home-section--hero">
        <div className="hero-staff" aria-hidden="true">
          <div className="hero-staff__wide"><S.StaffLines width={1200} height={200} /></div>
          <div className="hero-staff__narrow"><S.StaffLines width={520} height={160} /></div>
        </div>
        <div className="hero">
          <div className="hero__copy">
            <h1 className="sn-display" style={{ fontSize: 'clamp(36px, 5.2vw, 64px)' }}>API and MCP layer for Stellar contracts.</h1>
            <p className="sn-body sn-muted" style={{ marginTop: 20, maxWidth: 520 }}>
              REST endpoints, an MCP server, AI-ready docs and full on-chain history for any Soroban contract, in about thirty seconds. No backend, no SDK, no custody.
            </p>
            <div className="hero__ctas" style={{ marginTop: 36 }}>
              <S.Button size="lg" arrow onClick={() => router.push('/contracts')}>Connect with Freighter</S.Button>
              <S.Button size="lg" variant="secondary" onClick={() => router.push('/explorer')}>Browse contracts</S.Button>
            </div>
            <div className="sn-small sn-muted" style={{ marginTop: 14 }}>Non-custodial · no keys stored · Testnet &amp; Mainnet · <Link href="/docs">Read the docs</Link></div>
          </div>
          <div className="hero-rows">
            {WELCOME_ROWS.map((w, i) => (
              <div key={i} className="hero-row">
                <S.Numeral index={i + 1} size="lg" />
                <div>
                  <div className="sn-h3">{w.name}</div>
                  <div className="sn-body sn-muted" style={{ marginTop: 4 }}>{w.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="home-section" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="sn-stat-row">
          {HOME_STATS.map((s, i) => <S.Stat key={i} label={s.label} value={s.value} unit={s.unit} note={s.note} />)}
        </div>
      </section>

      {/* How it works */}
      <section className="home-section">
        <div className="home-section__head">
          <Label className="sn-muted">How it works</Label>
          <h2 className="sn-h1">One contract ID becomes the operating layer for apps and agents.</h2>
        </div>
        <div className="steps">
          {HOME_STEPS.map((s, i) => (
            <div key={i} className="step">
              <S.Numeral index={i + 1} size="lg" />
              <div className="sn-h3">{s.name}</div>
              <div className="sn-body sn-muted">{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Surfaces */}
      <section className="home-section">
        <div className="home-section__head">
          <Label>Platform surfaces</Label>
          <h2 className="sn-h1">One source of truth. Four production interfaces.</h2>
        </div>
        <div className="surfaces">
          {HOME_SURFACES.map((s, i) => (
            <div key={i} className="surface">
              <S.Numeral index={i + 1} size="lg" />
              <div className="surface__body">
                <div className="sn-label sn-muted">{s.audience}</div>
                <div className="sn-h3">{s.name}</div>
                <div className="sn-body sn-muted">{s.d}</div>
                <div className="sn-mono surface__endpoint" style={{ marginTop: 4 }}>{s.endpoint}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Code */}
      <section className="home-section">
        <div className="two-col">
          <div>
            <div className="home-section__head" style={{ marginBottom: 20 }}>
              <Label>REST transaction build</Label>
              <h2 className="sn-h2">HTTP in, unsigned XDR out.</h2>
            </div>
            <CodeBox right={<CopyButton S={S} text={HOME_CURL}>Copy</CopyButton>}>
              <pre className="sn-mono" style={PRE}>{HOME_CURL}</pre>
            </CodeBox>
          </div>
          <div>
            <div className="home-section__head" style={{ marginBottom: 20 }}>
              <Label>AI agent setup</Label>
              <h2 className="sn-h2">Give Claude contract-level tools.</h2>
            </div>
            <CodeBox right={<CopyButton S={S} text={HOME_MCP}>Copy</CopyButton>}>
              <pre className="sn-mono" style={PRE}>{HOME_MCP}</pre>
            </CodeBox>
            <div style={{ marginTop: 16 }}>
              <Link className="sn-label" href="/docs/mcp" style={{ textDecoration: 'none', borderBottom: '1px solid var(--sn-ink)' }}>MCP docs →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="home-section">
        <div className="page-head">
          <div>
            <h2 className="sn-h1">Ready when your contract is.</h2>
            <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 520 }}>Register a contract, create a key, and call it from anywhere. Start on Testnet, switch to Mainnet when you ship.</p>
          </div>
          <div className="actions">
            <S.Button arrow onClick={() => router.push('/register')}>Register a contract</S.Button>
            <S.Button variant="secondary" onClick={() => router.push('/explorer')}>Browse 1,204 contracts</S.Button>
          </div>
        </div>
      </section>
    </main>
  );
}
