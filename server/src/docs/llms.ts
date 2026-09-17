import type { ContractModel } from '../types.js';

export const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

export function llmsTxt(m: ContractModel, cfg: { publicBaseUrl: string }): string {
  const base = `${cfg.publicBaseUrl}/c/${m.id}`;
  const title = m.name ?? shortId(m.id);
  const lines: string[] = [
    `# ${title}`, '',
    `Soroban contract · ${m.functions.length} functions · SEP-48 · ${m.network}`,
    `Contract ID: ${m.id}`, '',
    '## Endpoints', '',
    `Base: ${base}`,
    `POST ${base}/call/{fn}   simulate any function → { result, simulated: true, auth }`,
    `POST ${base}/tx/{fn}     build unsigned XDR → { xdr, fee, auth }`,
    `POST ${base}/submit      relay a signed XDR → { hash, status }`,
    `GET  ${base}/openapi.json`,
    `MCP: ${base}/mcp (Streamable HTTP)`, '',
    'Arguments are passed by name in `args`. Integers ≥ 64-bit are decimal strings, bytes are 0x-hex, maps are objects.', '',
    '```',
    `curl -X POST "${base}/call/${m.functions[0]?.name ?? 'fn'}" -H "Content-Type: application/json" -d '{"args":{}}'`,
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
