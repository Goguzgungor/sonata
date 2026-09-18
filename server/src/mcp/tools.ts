import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { contract } from '@stellar/stellar-sdk';
import { ApiError } from '../errors.js';
import type { Deps } from '../http/deps.js';
import { decodeResult, encodeArgs, namedContractError } from '../spec/codec.js';
import type { ContractModel, JsonSchema, McpScope } from '../types.js';
import { shortId } from '../docs/llms.js';

const MAX_NAME = 64;
const toolName = (prefix: string, fn: string) => `${prefix}${fn}`.slice(0, MAX_NAME);
const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;
const withSource = (s: JsonSchema, required: boolean): JsonSchema => {
  const props = { ...(s.properties as object), source: { type: 'string', description: 'G… account used as transaction source' } };
  const req = [...((s.required as string[]) ?? []), ...(required ? ['source'] : [])];
  return { type: 'object', properties: props, ...(req.length ? { required: req } : {}), additionalProperties: false };
};
const CALL_OUT: JsonSchema = { type: 'object', properties: { result: {}, simulated: { type: 'boolean' }, latency_ms: { type: 'integer' }, ledger: { type: 'integer' }, auth: { type: 'array', items: { type: 'string' } } }, required: ['result', 'simulated'] };
const BUILD_OUT: JsonSchema = { type: 'object', properties: { xdr: { type: 'string' }, fee: { type: 'string' }, auth: { type: 'array', items: { type: 'string' } }, ledger: { type: 'integer' }, expires_at: { type: 'string' } }, required: ['xdr'] };
const TX_OUT: JsonSchema = { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string' }, ledger: { type: 'integer' }, fee_charged: { type: 'string' }, return_value: { type: 'string', description: 'Returned ScVal (base64), on success only' }, result_xdr: { type: 'string', description: 'TransactionResult (base64)' } }, required: ['hash', 'status'] };
const DOCS_OUT: JsonSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });
/** Serializes an already-named error. Ruling: contract-error → spec-name renaming lives once, in
 * spec/codec.ts's namedContractError; callers rethrow through it and hand the renamed error here. */
const fail = (e: unknown) => {
  const body: Record<string, unknown> = e instanceof ApiError ? e.toJSON() : { error: 'internal', message: (e as Error)?.message ?? String(e) };
  return { content: [{ type: 'text' as const, text: JSON.stringify(body) }], isError: true };
};

export function buildMcpServer(model: ContractModel, spec: contract.Spec, scope: McpScope, deps: Deps): McpServer {
  const server = new McpServer({ name: `sonata-${(model.name ?? shortId(model.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, version: '0.1.0' });
  const { chain, cfg } = deps;

  for (const f of model.functions) {
    const desc = `${f.doc ? f.doc.trim() + '\n\n' : ''}${sig(f)}\nKind: ${f.kind}. Simulates on ${model.network}; nothing is signed or sent.`;
    server.registerTool(toolName('call_', f.name), { description: desc, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, false)), outputSchema: fromJsonSchema(CALL_OUT) },
      async (args) => {
        try {
          const { source, ...rest } = args;
          const sim = await chain.simulate(model.network, model.id, f.name, encodeArgs(spec, f.name, rest), (source as string) ?? cfg.simSourceAccount);
          return ok({ result: decodeResult(spec, f.name, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth });
        } catch (e) {
          try { namedContractError(e, model, spec); } catch (named) { return fail(named); }
        }
      });
    if (scope === 'rw') {
      const buildDesc = `${f.doc ? f.doc.trim() + '\n\n' : ''}${sig(f)}\nKind: ${f.kind}. Builds an UNSIGNED transaction on ${model.network}; returns XDR for a wallet to sign; never signs or submits.`;
      server.registerTool(toolName('build_', f.name), { description: buildDesc, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, true)), outputSchema: fromJsonSchema(BUILD_OUT) },
        async (args) => {
          try {
            const { source, ...rest } = args;
            const b = await chain.buildTx(model.network, model.id, f.name, encodeArgs(spec, f.name, rest), source as string, { timeoutS: 300 });
            return ok({ xdr: b.xdr, fee: b.fee, auth: b.auth, ledger: b.ledger, expires_at: b.expiresAt });
          } catch (e) {
            try { namedContractError(e, model, spec); } catch (named) { return fail(named); }
          }
        });
    }
  }
  if (scope === 'rw') {
    server.registerTool('submit_transaction', { description: 'Submit a signed transaction envelope (base64 XDR) and wait up to 30s for the result.', inputSchema: fromJsonSchema<{ xdr: string }>({ type: 'object', properties: { xdr: { type: 'string' } }, required: ['xdr'] }), outputSchema: fromJsonSchema(TX_OUT) },
      async ({ xdr }) => {
        try {
          const t = await chain.submit(model.network, xdr, 30_000);
          return ok({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.returnValue && { return_value: t.returnValue }), ...(t.resultXdr && { result_xdr: t.resultXdr }) });
        } catch (e) {
          try { namedContractError(e, model, spec); } catch (named) { return fail(named); }
        }
      });
  }
  server.registerTool('search_functions', { description: 'Find contract functions by name or purpose (case-insensitive substring on name/doc), sorted alphabetically.', inputSchema: fromJsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }) },
    async ({ query }) => {
      const q = query.toLowerCase();
      const functions = model.functions.filter((f) => f.name.toLowerCase().includes(q) || f.doc.toLowerCase().includes(q)).map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind })).sort((a, b) => a.name.localeCompare(b.name));
      return ok({ functions });
    });
  server.registerTool('get_docs', { description: 'llms.txt for this contract: functions, types, errors, events and endpoints.', inputSchema: fromJsonSchema<Record<string, never>>({ type: 'object', properties: {} }), outputSchema: fromJsonSchema(DOCS_OUT) },
    async () => { const { row } = await deps.registry.ready(model.id); const text = row.llmsTxt ?? ''; return { content: [{ type: 'text' as const, text }], structuredContent: { text } }; });
  server.registerResource('llms.txt', `sonata://c/${model.id}/llms.txt`, { description: 'AI-ready contract docs', mimeType: 'text/markdown' },
    async (uri) => { const { row } = await deps.registry.ready(model.id); return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: row.llmsTxt ?? '' }] }; });
  return server;
}
