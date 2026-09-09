import { notFound } from 'next/navigation';
import FlowDetail from '@/components/screens/FlowDetail';
import { FLOWS, FLOW_BY_SLUG } from '@/components/flows-data';

export function generateStaticParams() {
  return FLOWS.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const f = FLOW_BY_SLUG[slug];
  return { title: (f ? f.name : 'Flow') + ' · Flows · Sonata' };
}

export default async function Page({ params }) {
  const { slug } = await params;
  const f = FLOW_BY_SLUG[slug];
  if (!f) notFound();
  return <FlowDetail flow={f} />;
}
