import './globals.css';
import TopNav from '@/components/TopNav';
import SiteFooter from '@/components/SiteFooter';
import { SessionProvider } from '@/components/SessionProvider';
import { SITE_URL } from '@/components/data';
import { SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from '@/components/seo';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s · Sonata' },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['Stellar', 'Soroban', 'smart contracts', 'REST API', 'MCP server', 'AI agents', 'Claude', 'Cursor', 'blockchain API', 'contract indexer'],
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  category: 'technology',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
  icons: { icon: '/icon.svg' },
  formatDetection: { telephone: false, email: false, address: false }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F5F3EE'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <TopNav />
          {children}
          <SiteFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
