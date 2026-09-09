import { notFound } from 'next/navigation';
import DocsPage from '@/components/screens/DocsPage';
import { DOCS, DOC_BY_SLUG } from '@/components/docs-data';

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug !== 'overview').map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = DOC_BY_SLUG[slug];
  return { title: (doc ? doc.title : 'Docs') + ' · Docs · Sonata' };
}

export default async function Page({ params }) {
  const { slug } = await params;
  if (!DOC_BY_SLUG[slug]) notFound();
  return <DocsPage slug={slug} />;
}
