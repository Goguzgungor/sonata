import { notFound } from 'next/navigation';
import ContractPublic from '@/components/screens/ContractPublic';
import { PUBLIC_CONTRACTS, CONTRACT_BY_ID } from '@/components/explorer-data';
import { pageMeta } from '@/components/seo';

export function generateStaticParams() {
  return PUBLIC_CONTRACTS.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const c = CONTRACT_BY_ID[id];
  if (!c) return pageMeta({ title: 'Contract', path: '/explorer' });
  return pageMeta({ title: c.name + ' · Explorer', description: c.d + ' ' + c.fns + ' functions, ' + c.tools + ' MCP tools, ' + c.category + ' on ' + c.net + '.', path: '/explorer/' + c.id });
}

export default async function Page({ params }) {
  const { id } = await params;
  const c = CONTRACT_BY_ID[id];
  if (!c) notFound();
  return <ContractPublic contract={c} />;
}
