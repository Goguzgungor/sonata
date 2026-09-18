import { describe, it, expect } from 'vitest';
import { DOC_BY_SLUG } from '@/components/docs-data';

/** Walks every `p`/`code`/`kv` block's text so a stray occurrence of the scoped-endpoint path
 * outside the "Scoped endpoints" section (where it belongs) is caught, not just the obvious spots. */
const blockText = (b) => [b.p, b.code, ...(b.kv || []).map((kv) => `${kv.key} ${kv.value}`), ...(b.list || [])].filter(Boolean).join('\n');

describe('MCP docs page', () => {
  it('has the expected intro', () => {
    expect(DOC_BY_SLUG.mcp.intro).toBe('One endpoint for every registered contract.');
  });
  it('mentions the scoped per-contract MCP path only inside "Scoped endpoints"', () => {
    const NEEDLE = '/c/{contractId}/mcp';
    for (const section of DOC_BY_SLUG.mcp.sections) {
      for (const block of section.blocks) {
        if (blockText(block).includes(NEEDLE)) {
          expect(section.h).toBe('Scoped endpoints');
        }
      }
    }
  });
});
