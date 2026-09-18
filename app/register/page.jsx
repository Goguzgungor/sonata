import Register from '@/components/screens/Register';
import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Register contract', description: 'Paste a Soroban contract ID to generate its REST API, MCP tools and AI-ready docs.', path: '/register' });
export default async function Page({ searchParams }) {
  const { id } = await searchParams;
  return <Register initialId={typeof id === 'string' ? id : ''} />;
}
