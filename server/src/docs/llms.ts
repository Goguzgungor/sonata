import type { ContractModel, JsonSchema } from '../types.js';

export const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;

/** The canonical all-zero ed25519 account: a real, encodable address, so the example below does not 400. */
const PLACEHOLDER_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * One valid value for a schema produced by spec/schema.ts, so the curl example in the docs is a
 * request the server actually accepts (review finding M-a: it used to send `{"args":{}}`, which
 * 400s for every function that takes arguments).
 */
function placeholder(s: JsonSchema): unknown {
  if (Array.isArray(s.oneOf)) {                                        // union: the first case
    const c = s.oneOf[0] as JsonSchema | undefined;
    if (!c) return null;
    if ('const' in c) return c.const;                                  // void case → the bare name
    const props = (c.properties ?? {}) as Record<string, JsonSchema>;
    return { tag: (props.tag as JsonSchema)?.const, values: ((props.values?.prefixItems ?? []) as JsonSchema[]).map(placeholder) };
  }
  if (Array.isArray(s.anyOf)) return null;                             // Option → null
  switch (s.type) {
    case 'integer': return Array.isArray(s.enum) ? s.enum[0] : 0;      // a C-style enum only accepts a declared case
    case 'boolean': return true;
    case 'null': return null;
    case 'array': {
      const prefix = s.prefixItems as JsonSchema[] | undefined;        // tuple → one value per slot
      return prefix ? prefix.map(placeholder) : [];
    }
    case 'object': {
      const props = s.properties as Record<string, JsonSchema> | undefined;
      if (!props) return {};                                           // Map<K, V> → an empty object
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, placeholder(v)]));
    }
    case 'string': {
      const pattern = typeof s.pattern === 'string' ? s.pattern : '';
      if (pattern.startsWith('^0x')) return '0x' + '00'.repeat(typeof s.minLength === 'number' ? (s.minLength - 2) / 2 : 1);
      if (/^\^-\?\[0-9\]|^\^\[0-9\]/.test(pattern)) return '0';   // u64/i128/… are decimal strings
      if (String(s.description ?? '').startsWith('Stellar address')) return PLACEHOLDER_ADDRESS;
      return 'example';                                                // Symbol and String share one schema
    }
    default: return null;
  }
}

/** A ready-to-send `args` object for one function's argument schema. Exported for the docs tests. */
export const exampleArgs = (schema: JsonSchema): Record<string, unknown> =>
  placeholder(schema) as Record<string, unknown>;

const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

export function llmsTxt(m: ContractModel, cfg: { publicBaseUrl: string }): string {
  const base = `${cfg.publicBaseUrl}/c/${m.id}`;
  const title = m.name ?? shortId(m.id);
  const lines: string[] = [
    `# ${title}`, '',
    `${m.sac ? 'Stellar Asset Contract (SEP-41 token)' : 'Soroban contract'} · ${m.functions.length} functions · SEP-48 · ${m.network}`,
    `Contract ID: ${m.id}`,
    `Explorer: https://stellar.expert/explorer/${m.network === 'mainnet' ? 'public' : 'testnet'}/contract/${m.id}`, '',
    '## Endpoints', '',
    `Base: ${base}`,
    `POST ${base}/call/{fn}   simulate any function → { result, simulated: true, auth }`,
    `POST ${base}/tx/{fn}     build unsigned XDR → { xdr, fee, auth }`,
    `POST ${base}/submit      relay a signed XDR → { hash, status }`,
    `GET  ${base}/openapi.json`,
    `GET  ${base}/events?type=&address=&from=&to=&cursor=&limit=&format=   decoded events, last ~7 days`,
    `MCP (all contracts): ${cfg.publicBaseUrl}/mcp — tools list_contracts, get_contract, get_events, call, build, submit`,
    `MCP (this contract): ${base}/mcp`, '',
    'Arguments are passed by name in `args`. Integers ≥ 64-bit are decimal strings, bytes are 0x-hex, maps are objects keyed by the map key, enums are integers, unions are "Name" for a void case or {tag, values} otherwise, tuples are arrays, and an Option is the value or null.', '',
    '```',
    `curl -X POST "${base}/call/${m.functions[0]?.name ?? 'fn'}" -H "Content-Type: application/json" -d '${JSON.stringify({ args: m.functions[0] ? exampleArgs(m.functions[0].jsonSchema) : {} })}'`,
    '```', '',
    '## Functions', ''
  ];
  for (const f of m.functions) { lines.push(`${sig(f)}${f.kind === 'read' ? '  [read]' : f.kind === 'write' ? '  [write]' : ''}`); if (f.doc) lines.push(`  ${f.doc.replace(/\s+/g, ' ').trim()}`); }
  lines.push('', '## Types', '');
  for (const t of m.types) lines.push(`${t.name} (${t.kind})${t.doc ? ` · ${t.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.types.length === 0) lines.push('(none)');
  lines.push('', '## Errors', '');
  for (const e of m.errors) lines.push(`${e.code} ${e.name}${e.doc ? ` · ${e.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.errors.length === 0) lines.push('(none)');
  lines.push('', '## Events', '');
  for (const e of m.events) lines.push(`${e.name}(${e.params.map((p) => `${p.name}: ${p.type}`).join(', ')})${e.doc ? ` · ${e.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.events.length === 0) lines.push('(none)');
  return lines.join('\n') + '\n';
}
