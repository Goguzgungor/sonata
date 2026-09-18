import { notFound } from 'next/navigation';
import Workspace from '@/components/workspace/Workspace';
import { TAB_LABEL } from '@/components/data';
import { pageMeta } from '@/components/seo';

export async function generateMetadata({ params }) {
  const { id, tab } = await params;
  const label = TAB_LABEL[tab] || 'Overview';
  return pageMeta({ title: `${label} · ${id.slice(0, 4)}…${id.slice(-4)}`, description: `Contract workspace: ${label.toLowerCase()} for the generated REST API, MCP server and docs.`, path: `/c/${id}/${TAB_LABEL[tab] ? tab : 'overview'}` });
}

export default async function Page({ params }) {
  const { id, tab } = await params;
  if (!TAB_LABEL[tab]) notFound();     // only the five real tabs are routes
  return <Workspace id={id} tab={tab} />;
}
