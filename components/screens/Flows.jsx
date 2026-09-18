'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSonataUI } from '@/lib/sonata';
import { Label } from '@/components/ui';
import PreviewBar from '@/components/PreviewBar';
import { FLOWS, INTENTS, PROTOCOLS } from '@/components/flows-data';

function ChipRow({ label, items, value, onChange }) {
  return (
    <div>
      <div className="sn-label sn-muted" style={{ marginBottom: 10 }}>{label}</div>
      <div className="chip-row" role="group" aria-label={label}>
        {items.map((it) => (
          <button key={it} type="button" className={'sn-chip chip-row__chip' + (value === it ? ' sn-chip--inverse' : '')} aria-pressed={value === it} onClick={() => onChange(it)}>
            {it === 'all' ? 'All ' + label.toLowerCase() : it}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Flows() {
  const S = useSonataUI();
  const [intent, setIntent] = useState('all');
  const [protocol, setProtocol] = useState('all');
  if (!S) return null;
  const list = FLOWS.filter((f) => (intent === 'all' || f.intent === intent) && (protocol === 'all' || f.protocol === protocol));
  return (
    <main className="page" style={{ gap: 32 }}>
      <PreviewBar />
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="sn-label sn-muted">Flow engine</div>
          <h1 className="sn-h1" style={{ marginTop: 10 }}>Flows</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 600 }}>Published recipes that build a complete transaction from a few inputs. Sonata reads the rest from the contract spec and on-chain state. Run one over REST or as the <span className="sn-mono">run_flow</span> MCP tool.</p>
        </div>
        <Link className="sn-label" href="/docs/api" style={{ textDecoration: 'none', borderBottom: '1px solid var(--sn-ink)' }}>How to author a flow →</Link>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <ChipRow label="Intents" items={INTENTS} value={intent} onChange={setIntent} />
        <ChipRow label="Protocols" items={PROTOCOLS} value={protocol} onChange={setProtocol} />
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>{list.length} {list.length === 1 ? 'flow' : 'flows'}</Label>
        {list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-small sn-muted">No flows match these filters.</span></div>
        ) : (
          <div className="card-grid">
            {list.map((f, i) => (
              <Link key={f.slug} className="card" href={'/flows/' + f.slug}>
                <div className="card__top">
                  <S.Numeral index={i + 1} />
                  <div className="card__chips">
                    <S.Chip tone="inverse">{f.intent}</S.Chip>
                    <S.Chip>{f.protocol}</S.Chip>
                  </div>
                </div>
                <div className="sn-h3 card__title">{f.name}</div>
                <div className="sn-mono sn-muted">{f.slug}</div>
                <p className="sn-small sn-muted card__desc">{f.d}</p>
                <div className="card__inputs">
                  <div className="sn-label sn-muted">{f.inputs.length} {f.inputs.length === 1 ? 'input' : 'inputs'} · {f.kind}</div>
                  <div className="sn-mono card__names">{f.inputs.map(([k]) => k).join(', ')}</div>
                </div>
                <div className="card__foot">
                  <span className="sn-label">Open flow</span>
                  <span className="sn-mono">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
