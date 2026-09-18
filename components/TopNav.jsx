'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletButton from '@/components/WalletButton';

const NAV = [
  { label: 'Explorer', href: '/explorer', match: (p) => p.startsWith('/explorer') },
  { label: 'Contracts', href: '/contracts', match: (p) => p.startsWith('/contracts') || p.startsWith('/register') || p.startsWith('/c/') },
  { label: 'Docs', href: '/docs', match: (p) => p.startsWith('/docs') }
];

export default function TopNav() {
  const pathname = usePathname();
  return (
    <header className="site-nav">
      <Link className="brand" href="/">Sonata</Link>
      <nav className="nav-links" aria-label="Primary">
        {NAV.map((n, i) => (
          <Link key={i} className={'sn-label nav-link' + (n.match(pathname) ? ' is-active' : '')} href={n.href}>{n.label}</Link>
        ))}
      </nav>
      <div className="nav-right">
        <WalletButton />
      </div>
    </header>
  );
}
