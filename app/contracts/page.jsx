import Contracts from '@/components/screens/Contracts';
import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'My contracts', description: 'Registered Soroban contracts and their generated REST, MCP, docs and history surfaces.', path: '/contracts' });
export default function Page() {
  return <Contracts />;
}
