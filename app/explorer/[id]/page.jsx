import { notFound } from 'next/navigation';
import ContractPublic from '@/components/screens/ContractPublic';
import { PUBLIC_CONTRACTS, CONTRACT_BY_ID } from '@/components/explorer-data';

export function generateStaticParams() {
  return PUBLIC_CONTRACTS.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const c = CONTRACT_BY_ID[id];
  return { title: (c ? c.name : 'Contract') + ' · Explorer · Sonata' };
}

export default async function Page({ params }) {
  const { id } = await params;
  const c = CONTRACT_BY_ID[id];
  if (!c) notFound();
  return <ContractPublic contract={c} />;
}
