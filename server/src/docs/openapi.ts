import type { ContractModel, JsonSchema } from '../types.js';

const ERROR: JsonSchema = { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' }, code: { type: 'integer' }, details: {} } };
const err = (d: string) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const json = (schema: JsonSchema) => ({ content: { 'application/json': { schema } } });
const AUTH = { type: 'array', items: { type: 'string' }, description: 'Addresses that must sign' };

export function openapi(m: ContractModel, cfg: { publicBaseUrl: string }): JsonSchema {
  const p = `/c/${m.id}`;
  const paths: Record<string, unknown> = {};
  for (const f of m.functions) {
    const body = { required: true, ...json({ type: 'object', required: ['args'], properties: { args: f.jsonSchema, source: { type: 'string', description: 'G… account' }, network: { type: 'string', enum: [m.network] } }, additionalProperties: false }) };
    const common = { '400': err('Invalid arguments or request'), '404': err('Unknown contract or function'), '409': err('Contract not ready'), '422': err('Contract or host error from simulation'), '502': err('RPC unavailable') };
    paths[`${p}/call/${f.name}`] = { post: { operationId: `call_${f.name}`, summary: `Simulate ${f.name}`, description: f.doc || undefined, tags: ['call'], requestBody: body,
      responses: { '200': { description: 'Simulation result', ...json({ type: 'object', properties: { result: {}, simulated: { type: 'boolean' }, latency_ms: { type: 'integer' }, ledger: { type: 'integer' }, auth: AUTH } }) }, ...common } } };
    paths[`${p}/tx/${f.name}`] = { post: { operationId: `build_${f.name}`, summary: `Build unsigned XDR for ${f.name}`, description: f.doc || undefined, tags: ['tx'],
      requestBody: { required: true, ...json({ type: 'object', required: ['args', 'source'], properties: { args: f.jsonSchema, source: { type: 'string' }, fee: { type: 'string', description: 'Per-operation inclusion fee in stroops (default 100). The response fee is the assembled total.' }, timeout_s: { type: 'integer' }, network: { type: 'string', enum: [m.network] } }, additionalProperties: false }) },
      responses: { '200': { description: 'Unsigned transaction', ...json({ type: 'object', properties: { xdr: { type: 'string' }, fee: { type: 'string' }, auth: AUTH, ledger: { type: 'integer' }, expires_at: { type: 'string' } } }) }, ...common } } };
  }
  const TX = { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string', enum: ['success', 'failed', 'pending'] }, ledger: { type: 'integer' }, fee_charged: { type: 'string' }, result_xdr: { type: 'string' } } };
  paths[`${p}/submit`] = { post: { operationId: 'submit', summary: 'Submit a signed transaction', tags: ['tx'], requestBody: { required: true, ...json({ type: 'object', required: ['xdr'], properties: { xdr: { type: 'string' } } }) }, responses: { '200': { description: 'Transaction status', ...json(TX) }, '400': err('Invalid XDR'), '422': err('Rejected by the network'), '502': err('RPC unavailable') } } };
  paths[`${p}`] = { get: { operationId: 'get_contract', summary: 'Contract model and settings', tags: ['contract'], responses: { '200': { description: 'Model', ...json({ type: 'object' }) }, '404': err('Unknown contract') } } };
  paths[`${p}/status`] = { get: { operationId: 'get_status', summary: 'Registration pipeline status', tags: ['contract'], responses: { '200': { description: 'Status', ...json({ type: 'object', properties: { status: { type: 'string' }, steps: { type: 'array' } } }) }, '404': err('Unknown contract') } } };
  paths[`${p}/llms.txt`] = { get: { operationId: 'get_llms', summary: 'AI-ready docs', tags: ['docs'], responses: { '200': { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } } } } };
  const schemas: Record<string, JsonSchema> = { Error: ERROR };
  for (const t of m.types) schemas[t.name] = t.jsonSchema;
  return {
    openapi: '3.1.0',
    info: { title: `${m.name ?? m.id} — Sonata API`, version: m.wasmHash.slice(0, 12), description: `Generated from the SEP-48 spec of ${m.id} on ${m.network}.` },
    servers: [{ url: cfg.publicBaseUrl }],
    paths,
    components: { schemas }
  };
}
