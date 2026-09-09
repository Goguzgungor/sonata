'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, ResponsiveTable } from '@/components/ui';
import { NET_OPTS } from '@/components/data';

const KEY_COLS = [
  { key: 'name', header: 'Name', width: '170px', strong: true },
  { key: 'k', header: 'Key', width: '200px', mono: true },
  { key: 'scopes', header: 'Scopes', width: '300px' },
  { key: 'created', header: 'Created', width: '130px', mono: true },
  { key: 'used', header: 'Last used', width: '120px', mono: true },
  { key: 'act', header: '', width: '110px', align: 'right' }
];

export default function Keys() {
  const S = useSonataUI();
  const router = useRouter();
  const [keys, setKeys] = useState([
    { name: 'Production', k: 'sk_live_…4Q9', scopes: ['read', 'write', 'history'], created: '2026-06-14', used: '2m ago' },
    { name: 'Local dev', k: 'sk_test_…M8P', scopes: ['read', 'history'], created: '2026-08-02', used: '1h ago' },
    { name: 'Agent runner', k: 'sk_live_…7LA', scopes: ['read'], created: '2026-08-27', used: '3d ago' }
  ]);
  const [net, setNet] = useState('testnet');
  if (!S) return null;
  const create = () => {
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    setKeys(keys.concat([{ name: 'New key', k: 'sk_test_…' + suffix, scopes: ['read'], created: '2026-09-09', used: 'never' }]));
  };
  const rows = keys.map((key, i) => ({
    name: key.name, k: key.k,
    scopes: <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{key.scopes.map((s, j) => <S.Chip key={j}>{s}</S.Chip>)}</div>,
    created: key.created, used: key.used,
    act: <S.Button variant="text" onClick={() => setKeys(keys.filter((_, j) => j !== i))}>Revoke</S.Button>
  }));
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <h1 className="sn-h1" style={{ margin: 0 }}>API keys</h1>
        <div className="actions">
          <S.Button arrow onClick={create}>Create key</S.Button>
        </div>
      </div>
      <ResponsiveTable S={S} columns={KEY_COLS} rows={rows} minWidth={1060} />
      <div style={{ maxWidth: 720 }}>
        <Label>Settings</Label>
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="sn-small" style={{ fontWeight: 700 }}>Default network</div>
          <div className="seg-wrap" style={{ alignSelf: 'flex-start' }}>
            <S.Segmented ariaLabel="Default network" options={NET_OPTS} value={net} onChange={setNet} />
          </div>
        </div>
        <div style={{ marginTop: 28 }}>
          <S.KeyValueList rows={[
            { key: 'Wallet', value: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}><span className="sn-mono">GBX7…4Q9</span><S.Button variant="text" onClick={() => router.push('/')}>Disconnect</S.Button></span> },
            { key: 'Plan', value: 'Builder', mono: false },
            { key: 'Usage', value: '12,480 / 100,000 requests' }
          ]} />
        </div>
      </div>
    </main>
  );
}
