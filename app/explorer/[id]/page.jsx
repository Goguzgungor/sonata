import ContractPublic from '@/components/screens/ContractPublic';
import { pageMeta } from '@/components/seo';
import { API_URL } from '@/lib/api';

/** Metadata only: a title/description a minute out of date is fine, and the page itself refetches on the client. */
async function fetchContract(id) {
  try {
    const res = await fetch(`${API_URL}/c/${id}`, { signal: AbortSignal.timeout(1500), next: { revalidate: 60 } });
    if (!res.ok) return null;
    const c = await res.json();
    return c.status === 'ready' ? c : null;
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const live = await fetchContract(id);
  if (live) {
    const name = live.name || id.slice(0, 4) + '…' + id.slice(-4);
    return pageMeta({ title: `${name} · Explorer`, description: `${name} on Stellar ${live.network}: ${live.functions.length} functions as a REST API, MCP tools and AI-ready docs.`, path: `/explorer/${id}` });
  }
  return pageMeta({ title: 'Contract', path: '/explorer' });
}

export default async function Page({ params }) {
  const { id } = await params;
  return <ContractPublic id={id} />;
}
