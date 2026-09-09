import Explorer from '@/components/screens/Explorer';

import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Contract explorer', description: 'Browse public Soroban contracts indexed by Sonata. Every one has a hosted API, MCP tools and docs you can use without registering.', path: '/explorer' });

export default function Page() {
  return <Explorer />;
}
