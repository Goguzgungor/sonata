'use client';
import { download } from '@/lib/sonata';
import { contracts, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';
import { Label, CopyButton } from '@/components/ui';

export default function Docs({ S, contract: c, id }) {
  const { data: text, error, loading, refetch } = useApi(() => (id ? contracts.llms(id) : Promise.resolve(null)), [id, c?.updated_at]);
  if (!c) return null;
  const file = (c.name || id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  return (
    <div className="two-col">
      <div>
        <Label style={{ marginBottom: 16 }}>llms.txt</Label>
        <Async S={S} loading={loading} error={error} onRetry={refetch}>
          <div className="code-panel"><pre className="sn-mono" style={{ fontSize: 12.5, lineHeight: 1.8, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></div>
        </Async>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>About these docs</Label>
        <S.KeyValueList rows={[
          { key: 'Format', value: 'Markdown · llms.txt', mono: false },
          { key: 'Generated', value: relTime(c.updated_at), mono: false },
          { key: 'Source', value: 'SEP-48 spec', mono: false },
          { key: 'URL', value: c.urls.llms }
        ]} />
        <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <CopyButton S={S} variant="primary" text={c.urls.llms}>Copy link</CopyButton>
          <S.Button variant="secondary" disabled={!text} onClick={() => download(file, text || '', 'text/markdown')}>Download .md</S.Button>
          <a className="crumb sn-label" href={c.urls.openapi} target="_blank" rel="noreferrer">OpenAPI JSON</a>
        </div>
        <div className="sn-small sn-muted" style={{ marginTop: 16 }}>Docs regenerate automatically when the contract's WASM changes or the contract is renamed.</div>
      </div>
    </div>
  );
}
