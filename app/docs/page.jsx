import DocsPage from '@/components/screens/DocsPage';

import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Docs', description: 'How Sonata turns a Soroban contract into a hosted API, an MCP server, llms.txt docs and an indexed event history.', path: '/docs' });

export default function Page() {
  return <DocsPage slug="overview" />;
}
