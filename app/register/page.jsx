import Register from '@/components/screens/Register';
import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Register contract', description: 'Paste a Soroban contract ID to generate its REST API, MCP tools, AI-ready docs and indexed history.', path: '/register' });
export default function Page() {
  return <Register />;
}
