import Flows from '@/components/screens/Flows';

import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Flows', description: 'Published recipes that build a complete Stellar transaction from a few inputs, over REST or as an MCP tool.', path: '/flows' });

export default function Page() {
  return <Flows />;
}
