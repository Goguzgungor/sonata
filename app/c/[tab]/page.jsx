import Workspace from '@/components/workspace/Workspace';
import { TAB_LABEL } from '@/components/data';
import { pageMeta } from '@/components/seo';

export function generateStaticParams() {
  return Object.keys(TAB_LABEL).map((tab) => ({ tab }));
}

export async function generateMetadata({ params }) {
  const { tab } = await params;
  const label = TAB_LABEL[tab] || 'Overview';
  return pageMeta({ title: label + ' · StellarSwap', description: 'StellarSwap contract workspace: ' + label.toLowerCase() + ' for its generated REST API, MCP server, docs and indexed history.', path: '/c/' + (TAB_LABEL[tab] ? tab : 'overview') });
}

export default async function Page({ params }) {
  const { tab } = await params;
  return <Workspace tab={tab} />;
}
