import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { contract } from '@stellar/stellar-sdk';
import type { Deps } from '../http/deps.js';
import type { ContractModel, McpScope } from '../types.js';
import { shortId } from '../docs/llms.js';
import { ok, fail, sig, withSource, toolName, CALL_OUT, BUILD_OUT, TX_OUT, DOCS_OUT, simulate, buildTx, submitTx, searchFunctions, docsOf } from './handlers.js';
import type { Ready } from './handlers.js';

export function buildMcpServer(model: ContractModel, spec: contract.Spec, scope: McpScope, deps: Deps): McpServer {
  const server = new McpServer({ name: `sonata-${(model.name ?? shortId(model.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, version: '0.1.0' });
  const r: Ready = { model, spec };

  for (const f of model.functions) {
    const desc = `${f.doc ? f.doc.trim() + '\n\n' : ''}${sig(f)}\nKind: ${f.kind}. Simulates on ${model.network}; nothing is signed or sent.`;
    server.registerTool(toolName('call_', f.name), { description: desc, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, false)), outputSchema: fromJsonSchema(CALL_OUT) },
      async (args) => {
        try {
          const { source, ...rest } = args;
          return ok(await simulate(deps, r, f.name, rest, source));
        } catch (e) { return fail(e); }
      });
    if (scope === 'rw') {
      const buildDesc = `${f.doc ? f.doc.trim() + '\n\n' : ''}${sig(f)}\nKind: ${f.kind}. Builds an UNSIGNED transaction on ${model.network}; returns XDR for a wallet to sign; never signs or submits.`;
      server.registerTool(toolName('build_', f.name), { description: buildDesc, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, true)), outputSchema: fromJsonSchema(BUILD_OUT) },
        async (args) => {
          try {
            const { source, ...rest } = args;
            return ok(await buildTx(deps, r, f.name, rest, source));
          } catch (e) { return fail(e); }
        });
    }
  }
  if (scope === 'rw') {
    server.registerTool('submit_transaction', { description: 'Submit a signed transaction envelope (base64 XDR) and wait up to 30s for the result.', inputSchema: fromJsonSchema<{ xdr: string }>({ type: 'object', properties: { xdr: { type: 'string' } }, required: ['xdr'] }), outputSchema: fromJsonSchema(TX_OUT) },
      async ({ xdr }) => {
        try { return ok(await submitTx(deps, r, xdr)); } catch (e) { return fail(e); }
      });
  }
  server.registerTool('search_functions', { description: 'Find contract functions by name or purpose (case-insensitive substring on name/doc), sorted alphabetically.', inputSchema: fromJsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }) },
    async ({ query }) => ok({ functions: searchFunctions(model, query) }));
  server.registerTool('get_docs', { description: 'llms.txt for this contract: functions, types, errors, events and endpoints.', inputSchema: fromJsonSchema<Record<string, never>>({ type: 'object', properties: {} }), outputSchema: fromJsonSchema(DOCS_OUT) },
    async () => { const text = await docsOf(deps, model.id); return { content: [{ type: 'text' as const, text }], structuredContent: { text } }; });
  server.registerResource('llms.txt', `sonata://c/${model.id}/llms.txt`, { description: 'AI-ready contract docs', mimeType: 'text/markdown' },
    async (uri) => { const text = await docsOf(deps, model.id); return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] }; });
  return server;
}
