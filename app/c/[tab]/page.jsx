import Workspace from '@/components/workspace/Workspace';
import { TAB_LABEL } from '@/components/data';

export function generateStaticParams() {
  return Object.keys(TAB_LABEL).map((tab) => ({ tab }));
}

export async function generateMetadata({ params }) {
  const { tab } = await params;
  return { title: (TAB_LABEL[tab] || 'Overview') + ' · StellarSwap · Sonata' };
}

export default async function Page({ params }) {
  const { tab } = await params;
  return <Workspace tab={tab} />;
}
