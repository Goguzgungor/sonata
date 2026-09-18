import ContractPublic from '@/components/screens/ContractPublic';
import { CONTRACT_BY_ID } from '@/components/explorer-data';
import { pageMeta } from '@/components/seo';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

async function fetchContract(id) {
  try {
    const res = await fetch(`${API_URL}/c/${id}`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!res.ok) return null;
    const c = await res.json();
    return c.status === 'ready' ? c : null;
  } catch { return null; }
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const live = await fetchContract(id);
  if (live) {
    const name = live.name || id.slice(0, 4) + '…' + id.slice(-4);
    return pageMeta({ title: `${name} · Explorer`, description: `${name} on Stellar ${live.network}: ${live.functions.length} functions as a REST API, MCP tools and AI-ready docs.`, path: `/explorer/${id}` });
  }
  const c = CONTRACT_BY_ID[id];
  if (c) return pageMeta({ title: c.name + ' · Explorer', description: c.d + ' ' + c.fns + ' functions, ' + c.tools + ' MCP tools, ' + c.category + ' on ' + c.net + '.', path: '/explorer/' + c.id });
  return pageMeta({ title: 'Contract', path: '/explorer' });
}

export default async function Page({ params }) {
  const { id } = await params;
  return <ContractPublic id={id} demo={CONTRACT_BY_ID[id] || null} />;
}
