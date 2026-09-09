import './globals.css';
import TopNav from '@/components/TopNav';
import SiteFooter from '@/components/SiteFooter';
import { SITE_URL } from '@/components/data';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Sonata — API and MCP layer for Stellar contracts',
  description: 'REST endpoints, an MCP server, AI-ready docs and full on-chain history for any Stellar contract, in about thirty seconds.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Sonata',
    title: 'Sonata — API and MCP layer for Stellar contracts',
    description: 'REST endpoints, an MCP server, AI-ready docs and full on-chain history for any Stellar contract, in about thirty seconds.'
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
