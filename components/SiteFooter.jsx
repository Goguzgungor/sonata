import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <Link className="brand" href="/">Sonata</Link>
        <div className="sn-small sn-muted">API and MCP layer for Stellar contracts. Preview build with sample data.</div>
      </div>
      <nav className="site-footer__links sn-label" aria-label="Footer">
        <Link href="/explorer">Explorer</Link>
        <Link href="/flows">Flows</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/docs/quickstart">Quickstart</Link>
        <Link href="/docs/api">REST API</Link>
        <Link href="/docs/mcp">MCP</Link>
        <Link href="/contracts">Contracts</Link>
      </nav>
    </footer>
  );
}
