'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton } from '@/components/ui';
import { contracts, health, mcpToolCount, shortId, API_URL, mcpGlobalConfig, mcpGlobalOneLiner } from '@/lib/api';
import { useApi } from '@/lib/useApi';

const PRE = { margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const ROWS = [
  { name: 'REST API', d: 'Every contract function becomes an HTTP endpoint: simulate reads, build unsigned transactions, submit signed ones.' },
  { name: 'MCP server', d: 'Typed tools any AI agent can call — read-only by default, read + write when the owner enables it.' },
  { name: 'AI-ready docs', d: 'llms.txt and OpenAPI 3.1 generated from the contract spec.' }
];
const STEPS = [
  { name: 'Connect and register', d: 'Connect a Stellar wallet, paste a Soroban contract ID. Sonata reads the SEP-48 spec from the network.' },
  { name: 'Generate surfaces', d: 'REST endpoints, an MCP server and docs are published under one URL in about thirty seconds.' },
  { name: 'Connect apps + agents', d: 'Backends, Claude, Cursor and autonomous agents call the contract over plain HTTP; your wallet signs in the browser.' }
];
const SURFACES = [
  { audience: 'Backend teams', name: 'Hosted REST API', d: 'Call any function with JSON. Sonata handles XDR encoding, simulation and fee estimation.', endpoint: 'POST /c/{contractId}/call/{fn}' },
  { audience: 'AI agents', name: 'MCP server', d: 'Search, docs, reads, simulation and transaction building exposed as tools.', endpoint: '/mcp' },
  { audience: 'Context windows', name: 'AI-ready docs', d: 'A compact llms.txt generated from the contract spec.', endpoint: 'GET /c/{contractId}/llms.txt' }
];
const firstRead = (c) => (c.functions || []).find((f) => f.kind === 'read') || (c.functions || [])[0];

export default function Welcome() {
  const S = useSonataUI();
  const router = useRouter();
  const list = useApi((signal) => contracts.list({ signal }), []);
  const hz = useApi((signal) => health({ signal }), []);
  const ready = (list.data || []).filter((c) => c.status === 'ready');
  const example = ready[0] ? ready[0] : null;                       // the list is newest-updated first
  const detail = useApi((signal) => (example ? contracts.get(example.id, { signal }) : Promise.resolve(null)), [example?.id]);
  if (!S) return null;
  const fns = ready.reduce((n, c) => n + c.fns, 0);
  const networks = hz.data ? Object.keys(hz.data.networks || {}).length : null;
  const stats = [
    { label: 'Contracts registered', value: list.data ? String(ready.length) : '—' },
    { label: 'Functions exposed', value: list.data ? fns.toLocaleString('en-US') : '—' },
    { label: 'MCP tools', value: list.data ? ready.reduce((n, c) => n + c.fns + 3, 0).toLocaleString('en-US') : '—', note: 'read-only scope' },
    { label: 'Networks live', value: networks === null ? '—' : String(networks), note: hz.data ? Object.keys(hz.data.networks).join(' · ') : '' }
  ];
  const ex = detail.data;
  const fn = ex ? firstRead(ex) : null;
  const curl = ex && fn
    ? `curl -X POST "${API_URL}/c/${ex.id}/call/${fn.name}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "args": {} }'\n\n# ${ex.name || shortId(ex.id)} · ${ex.network} · ${ex.functions.length} functions`
    : `curl -X POST "${API_URL}/c/{contractId}/call/{fn}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "args": {} }'`;
  const mcp = `${mcpGlobalConfig}\n\n# or\n${mcpGlobalOneLiner}`;
  return (
    <main className="home">
      {/* Hero: night scene — copy on the left, the painting bleeding off the right edge */}
      <section className="home-section home-section--hero hero-scene">
        <div className="hero hero--scene">
          <div className="hero__copy">
            <div className="hero-staff" aria-hidden="true">
              <div className="hero-staff__wide"><S.StaffLines width={620} height={104} /></div>
              <div className="hero-staff__narrow"><S.StaffLines width={520} height={96} /></div>
            </div>
            <h1 className="sn-display" style={{ fontSize: 'clamp(36px, 5.2vw, 64px)' }}>API and MCP layer for Stellar contracts.</h1>
            <p className="sn-body sn-muted" style={{ marginTop: 20, maxWidth: 520 }}>
              REST endpoints, an MCP server and AI-ready docs for any Soroban contract, in about thirty seconds. No backend, no SDK, no custody.
            </p>
            <div className="hero__ctas" style={{ marginTop: 36 }}>
              <S.Button size="lg" arrow onClick={() => router.push('/register')}>Register a contract</S.Button>
              <S.Button size="lg" variant="secondary" onClick={() => router.push('/explorer')}>Browse contracts</S.Button>
            </div>
            <div className="sn-small sn-muted" style={{ marginTop: 14 }}>Non-custodial · your wallet signs · Testnet &amp; Mainnet · <Link href="/docs">Read the docs</Link></div>
            <div className="hero-rows">
              {ROWS.map((w, i) => (
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
          <figure className="hero-art">
            <Image
              src="/hero-pianist.jpg"
              alt=""
              fill
              priority
              sizes="(max-width: 980px) 100vw, 46vw"
              className="hero-art__img"
            />
            <span className="hero-art__blend" aria-hidden="true" />
          </figure>
        </div>
      </section>

      {/* Stats */}
      <section className="home-section" style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="sn-stat-row">
          {stats.map((s, i) => <S.Stat key={i} label={s.label} value={s.value} unit={s.unit} note={s.note} />)}
        </div>
      </section>

      {/* How it works */}
      <section className="home-section">
        <div className="home-section__head">
          <Label className="sn-muted">How it works</Label>
          <h2 className="sn-h1">One contract ID becomes the operating layer for apps and agents.</h2>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
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
          <h2 className="sn-h1">One source of truth. Three production interfaces.</h2>
        </div>
        <div className="surfaces">
          {SURFACES.map((s, i) => (
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
            <CodeBox right={<CopyButton S={S} text={curl}>Copy</CopyButton>}>
              <pre className="sn-mono" style={PRE}>{curl}</pre>
            </CodeBox>
          </div>
          <div>
            <div className="home-section__head" style={{ marginBottom: 20 }}>
              <Label>AI agent setup</Label>
              <h2 className="sn-h2">Give Claude contract-level tools.</h2>
            </div>
            <CodeBox right={<CopyButton S={S} text={mcp}>Copy</CopyButton>}>
              <pre className="sn-mono" style={PRE}>{mcp}</pre>
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
            <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 520 }}>Connect a wallet, register a contract, and call it from anywhere. Start on Testnet, switch to Mainnet when you ship.</p>
          </div>
          <div className="actions">
            <S.Button arrow onClick={() => router.push('/register')}>Register a contract</S.Button>
            <S.Button variant="secondary" onClick={() => router.push('/explorer')}>Browse contracts</S.Button>
          </div>
        </div>
      </section>
    </main>
  );
}
