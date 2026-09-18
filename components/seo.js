import { SITE_URL } from './data';

export const SITE_NAME = 'Sonata';
export const SITE_TITLE = 'Sonata — API and MCP layer for Stellar contracts';
export const SITE_DESCRIPTION = 'Paste a Soroban contract ID and get a hosted REST API, an MCP server for AI agents and AI-ready docs in about thirty seconds. No backend, no SDK, no custody.';

/**
 * Per-page metadata. Titles get the "· Sonata" suffix from the root template;
 * Open Graph and X cards carry the full title so shares read well on their own.
 */
export function pageMeta({ title, description = SITE_DESCRIPTION, path = '/' }) {
  const full = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  return {
    title: title || undefined,
    description,
    alternates: { canonical: path },
    openGraph: { title: full, description, url: SITE_URL + path, siteName: SITE_NAME, type: 'website', locale: 'en_US' },
    twitter: { card: 'summary_large_image', title: full, description }
  };
}
