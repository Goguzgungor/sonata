'use client';
import { useState } from 'react';
import { download } from '@/lib/sonata';
import { Label, CopyButton } from '@/components/ui';
import { LLMS, API_URL } from '@/components/data';

export default function Docs({ S }) {
  const [gen, setGen] = useState('2m ago');
  return (
    <div className="two-col">
      <div>
        <Label style={{ marginBottom: 16 }}>llms.txt preview</Label>
        <div className="code-panel">
          <pre className="sn-mono" style={{ fontSize: 12.5, lineHeight: 1.8, fontFamily: 'var(--sn-font-mono)' }}>{LLMS}</pre>
        </div>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>About these docs</Label>
        <S.KeyValueList rows={[
          { key: 'Format', value: 'Markdown · llms.txt' },
          { key: 'Generated', value: gen },
          { key: 'Source', value: 'SEP-48 spec + dev notes', mono: false },
          { key: 'URL', value: '/c/CGA4…D4R/docs' }
        ]} />
        <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <CopyButton S={S} variant="primary" text={API_URL + '/c/CGA4…D4R/docs'}>Copy link</CopyButton>
          <S.Button variant="secondary" onClick={() => download('stellarswap.md', LLMS, 'text/markdown')}>Download .md</S.Button>
          <S.Button variant="text" onClick={() => setGen('just now')}>Regenerate</S.Button>
        </div>
      </div>
    </div>
  );
}
