'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';

const NAV = [
  { label: 'Explorer', href: '/explorer', match: (p) => p.startsWith('/explorer') },
  { label: 'Flows', href: '/flows', match: (p) => p.startsWith('/flows') },
  { label: 'Contracts', href: '/contracts', match: (p) => p.startsWith('/contracts') || p.startsWith('/register') || p.startsWith('/c/') },
  { label: 'Docs', href: '/docs', match: (p) => p.startsWith('/docs') }
];

export default function TopNav() {
  const S = useSonataUI();
  const pathname = usePathname();
  const home = pathname === '/';
  return (
    <>
      <header className="site-nav">
        <Link className="brand" href="/">Sonata</Link>
        <nav className="nav-links" aria-label="Primary">
          {NAV.map((n, i) => (
            <Link key={i} className={'sn-label nav-link' + (n.match(pathname) ? ' is-active' : '')} href={n.href}>{n.label}</Link>
          ))}
        </nav>
        <div className="nav-right">
          {S && <S.Chip>Testnet</S.Chip>}
          {!home && <span className="sn-mono nav-wallet">GBX7…4Q9</span>}
        </div>
      </header>
      <div className="preview-bar" role="note">
        <span className="preview-bar__dot" aria-hidden="true" />
        <span>Preview build · sample data<span className="preview-bar__long"> · nothing is sent to the network</span></span>
      </div>
    </>
  );
}
