'use client';
import Link from 'next/link';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton } from '@/components/ui';
import { DOCS, DOC_BY_SLUG } from '@/components/docs-data';

const PRE = { margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

function Block({ S, b }) {
  if (b.p) return <p className="sn-body">{b.p}</p>;
  if (b.list) return <ul className="sn-body">{b.list.map((t, i) => <li key={i}>{t}</li>)}</ul>;
  if (b.code) return (
    <CodeBox right={<CopyButton S={S} text={b.code}>Copy</CopyButton>}>
      <pre className="sn-mono" style={PRE}>{b.code}</pre>
    </CodeBox>
  );
  if (b.kv) return <S.KeyValueList rows={b.kv} />;
  return null;
}

export default function DocsPage({ slug }) {
  const S = useSonataUI();
  const doc = DOC_BY_SLUG[slug] || DOCS[0];
  const idx = DOCS.indexOf(doc);
  const prev = DOCS[idx - 1];
  const next = DOCS[idx + 1];
  if (!S) return null;
  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/docs">Docs</Link>{idx > 0 ? ' / ' + doc.nav : ''}</div>
      <div className="docs">
        <nav className="docs__index" aria-label="Docs">
          {DOCS.map((d, i) => (
            <Link key={d.slug} href={d.slug === 'overview' ? '/docs' : '/docs/' + d.slug} className={'docs__link' + (d.slug === doc.slug ? ' is-active' : '')}>
              <span>{d.nav}</span>
              <S.Numeral index={i + 1} />
            </Link>
          ))}
        </nav>
        <article className="docs__body">
          <div>
            <h1 className="sn-h1">{doc.title}</h1>
            <p className="sn-body sn-muted" style={{ marginTop: 14 }}>{doc.intro}</p>
          </div>
          {doc.sections.map((sec, i) => (
            <section key={i} className="docs__section">
              <Label>{sec.h}</Label>
              {sec.blocks.map((b, j) => <Block key={j} S={S} b={b} />)}
            </section>
          ))}
          <div className="docs__pager">
            <span>{prev ? <Link className="sn-label" href={prev.slug === 'overview' ? '/docs' : '/docs/' + prev.slug}>← {prev.nav}</Link> : null}</span>
            <span>{next ? <Link className="sn-label" href={'/docs/' + next.slug}>{next.nav} →</Link> : null}</span>
          </div>
        </article>
      </div>
    </main>
  );
}
