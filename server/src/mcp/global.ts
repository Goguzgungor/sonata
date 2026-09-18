import { McpServer, ResourceTemplate, fromJsonSchema } from '@modelcontextprotocol/server';
import type { Deps } from '../http/deps.js';
import type { ContractRow } from '../registry/store.js';
import { ApiError } from '../errors.js';
import { ok, fail, sig, simulate, buildTx, submitTx, getTx, searchFunctions, docsOf, CALL_OUT, BUILD_OUT, TX_OUT, DOCS_OUT, type Ready } from './handlers.js';

const NET = { type: 'string', enum: ['testnet', 'mainnet'] };
const ARGS = { type: 'object', description: 'Function arguments by name — get the schema from get_contract. ≥64-bit ints are decimal strings, bytes 0x-hex, maps objects, enums integers, unions "Name" or {tag, values}.', additionalProperties: true };
const listItem = (r: ContractRow) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, sac: r.model?.sac === true, owner: r.owner, updated_at: r.updatedAt.toISOString() });
const writeDisabled = (id: string) => new ApiError(403, 'write_tools_disabled', `the owner of ${id} has not enabled write tools; ask them to switch the MCP scope to read + write`);

/** One server for every registered contract: fixed generic tools, contract id as an argument. Built per request (stateless). */
export function buildGlobalMcpServer(deps: Deps): McpServer {
  const server = new McpServer({ name: 'sonata', version: '0.1.0' });
  const base = deps.cfg.publicBaseUrl;
  const ready = (id: string): Promise<Ready & { row: ContractRow }> => deps.registry.ready(id);
  const list = async (o: { network?: string; q?: string; include_pending?: boolean } = {}) => {
    const q = o.q?.toLowerCase();
    return (await deps.store.list()).filter((r) => (o.include_pending || r.status === 'ready') && (!o.network || r.network === o.network) && (!q || (r.name ?? '').toLowerCase().includes(q) || r.id.toLowerCase().includes(q))).slice(0, 200).map(listItem);
  };

  server.registerTool('list_contracts', { description: 'Contracts registered with Sonata (ready ones by default). Start here, then get_contract for a function list and argument schemas.', inputSchema: fromJsonSchema<{ network?: string; q?: string; include_pending?: boolean }>({ type: 'object', properties: { network: NET, q: { type: 'string', description: 'substring of name or id' }, include_pending: { type: 'boolean' } } }) },
    async (a) => { try { return ok({ contracts: await list(a) }); } catch (e) { return fail(e); } });
  server.registerTool('get_contract', { description: 'Functions (with JSON schemas for `args`), types, errors, events, scope and URLs of one contract.', inputSchema: fromJsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }) },
    async ({ id }) => {
      try {
        const { row, model } = await ready(id);
        return ok({ id: model.id, name: row.name, network: model.network, sac: model.sac === true, mcp_scope: row.mcpScope, owner: row.owner,
          functions: model.functions.map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind, input_schema: f.jsonSchema })),
          types: model.types, errors: model.errors, events: model.events,
          urls: { rest: `${base}/c/${model.id}`, mcp: `${base}/c/${model.id}/mcp`, llms: `${base}/c/${model.id}/llms.txt`, openapi: `${base}/c/${model.id}/openapi.json` } });
      } catch (e) { return fail(e); }
    });
  server.registerTool('search_functions', { description: 'Find functions of a contract by name or purpose.', inputSchema: fromJsonSchema<{ id: string; query: string }>({ type: 'object', properties: { id: { type: 'string' }, query: { type: 'string' } }, required: ['id', 'query'] }) },
    async ({ id, query }) => { try { const { model } = await ready(id); return ok({ functions: searchFunctions(model, query) }); } catch (e) { return fail(e); } });
  server.registerTool('get_docs', { description: 'llms.txt for a contract.', inputSchema: fromJsonSchema<{ id: string }>({ type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }), outputSchema: fromJsonSchema(DOCS_OUT) },
    async ({ id }) => { try { const t = await docsOf(deps, id); return { content: [{ type: 'text' as const, text: t }], structuredContent: { text: t } }; } catch (e) { return fail(e); } });
  server.registerTool('call', { description: 'Simulate a contract function (any function, read or write). Nothing is signed or sent. Use get_contract for the args schema.', inputSchema: fromJsonSchema<{ id: string; fn: string; args?: Record<string, unknown>; source?: string }>({ type: 'object', properties: { id: { type: 'string' }, fn: { type: 'string' }, args: ARGS, source: { type: 'string', description: 'G… account used as transaction source (optional)' } }, required: ['id', 'fn'] }), outputSchema: fromJsonSchema(CALL_OUT) },
    async ({ id, fn, args, source }) => { try { const r = await ready(id); return ok(await simulate(deps, r, fn, args ?? {}, source)); } catch (e) { return fail(e); } });
  server.registerTool('build', { description: 'Build an UNSIGNED transaction for a contract function; returns XDR for the user\'s wallet to sign. Only for contracts whose owner enabled read + write.', inputSchema: fromJsonSchema<{ id: string; fn: string; args?: Record<string, unknown>; source: string; fee?: string; timeout_s?: number }>({ type: 'object', properties: { id: { type: 'string' }, fn: { type: 'string' }, args: ARGS, source: { type: 'string', description: 'G… account that will sign' }, fee: { type: 'string' }, timeout_s: { type: 'integer' } }, required: ['id', 'fn', 'source'] }), outputSchema: fromJsonSchema(BUILD_OUT) },
    async ({ id, fn, args, source, fee, timeout_s }) => { try { const r = await ready(id); if (r.row.mcpScope !== 'rw') throw writeDisabled(id); return ok(await buildTx(deps, r, fn, args ?? {}, source, { fee, timeoutS: timeout_s })); } catch (e) { return fail(e); } });
  server.registerTool('submit', { description: 'Submit a signed transaction envelope (base64 XDR) for a contract and wait up to 30 s. Only for contracts whose owner enabled read + write.', inputSchema: fromJsonSchema<{ id: string; xdr: string }>({ type: 'object', properties: { id: { type: 'string' }, xdr: { type: 'string' } }, required: ['id', 'xdr'] }), outputSchema: fromJsonSchema(TX_OUT) },
    async ({ id, xdr }) => { try { const r = await ready(id); if (r.row.mcpScope !== 'rw') throw writeDisabled(id); return ok(await submitTx(deps, r, xdr)); } catch (e) { return fail(e); } });
  server.registerTool('get_tx', { description: 'Look up a submitted transaction by hash.', inputSchema: fromJsonSchema<{ hash: string; network: 'testnet' | 'mainnet' }>({ type: 'object', properties: { hash: { type: 'string' }, network: NET }, required: ['hash', 'network'] }), outputSchema: fromJsonSchema(TX_OUT) },
    async ({ hash, network }) => { try { return ok(await getTx(deps, network, hash)); } catch (e) { return fail(e); } });

  server.registerResource('contracts', 'sonata://contracts', { description: 'Registered contracts (JSON)', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ contracts: await list() }) }] }));
  server.registerResource('llms', new ResourceTemplate('sonata://c/{id}/llms.txt', { list: async () => ({ resources: (await list()).map((c) => ({ uri: `sonata://c/${c.id}/llms.txt`, name: c.name ?? c.id, mimeType: 'text/markdown' })) }) }), { description: 'AI-ready contract docs', mimeType: 'text/markdown' },
    async (uri, vars) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await docsOf(deps, String(vars.id)) }] }));
  return server;
}
