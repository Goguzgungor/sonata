'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { CopyButton } from '@/components/ui';
import { CONTRACT_ID, MCP_URL, WS_TABS, TAB_LABEL } from '@/components/data';
import Overview from './Overview';
import Functions from './Functions';
import Mcp from './Mcp';
import Docs from './Docs';
import History from './History';

export default function Workspace({ tab }) {
  const S = useSonataUI();
  const router = useRouter();
  const t = TAB_LABEL[tab] ? tab : 'overview';
  const tabsRef = useRef(null);
  // Keep the active tab visible when the tab strip scrolls horizontally on phones.
  useEffect(() => {
    const strip = tabsRef.current && tabsRef.current.querySelector('.sn-tabs');
    const active = strip && strip.querySelector('[aria-selected="true"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
  }, [S, t]);
  if (!S) return null;
  const Body = t === 'functions' ? Functions : t === 'mcp' ? Mcp : t === 'docs' ? Docs : t === 'history' ? History : Overview;
  return (
    <main className="page">
      <div className="sn-label sn-muted">
        <Link className="crumb" href="/contracts">Contracts</Link> / StellarSwap{t !== 'overview' ? ' / ' + TAB_LABEL[t] : ''}
      </div>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1" style={{ margin: 0 }}>StellarSwap</h1>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{CONTRACT_ID}</span>
            <CopyButton S={S} text={CONTRACT_ID}>Copy</CopyButton>
            <S.Chip>Testnet</S.Chip>
            <S.Chip tone="good">Indexed 2m ago</S.Chip>
          </div>
        </div>
        <div className="actions">
          <S.Button variant="secondary" onClick={() => router.push('/c/history')}>Export history</S.Button>
          <CopyButton S={S} variant="primary" arrow text={MCP_URL}>Copy MCP URL</CopyButton>
        </div>
      </div>
      <div ref={tabsRef} style={{ minWidth: 0 }}>
        <S.Tabs items={WS_TABS} active={t} onChange={(id) => router.push('/c/' + id)} />
      </div>
      <Body S={S} />
    </main>
  );
}
