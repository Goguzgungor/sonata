'use client';
import Link from 'next/link';
import { useSonataUI } from '@/lib/sonata';
import { shortAddr } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';

export default function WalletButton() {
  const S = useSonataUI();
  const { address, status, error, signIn, signOut } = useSession();
  if (!S) return null;
  if (address) return (
    <div className="wallet" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Link className="sn-mono nav-link" href="/contracts" title={address}>{shortAddr(address)}</Link>
      <S.Button variant="text" size="sm" onClick={signOut}>Disconnect</S.Button>
    </div>
  );
  return (
    <div className="wallet" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {error && <span className="sn-small sn-muted" role="status">{error.message}</span>}
      <S.Button size="sm" disabled={status === 'signing'} onClick={() => signIn().catch(() => {})}>{status === 'signing' ? 'Waiting for wallet…' : 'Connect wallet'}</S.Button>
    </div>
  );
}
