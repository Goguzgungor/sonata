import type { contract } from '@stellar/stellar-sdk';
import type { JsonSchema } from '../types.js';

const MAX_DEPTH = 6;

/** Inline every "#/definitions/X" $ref so the schema is self-contained (MCP and OpenAPI-friendly). */
export function inlineRefs(schema: JsonSchema): JsonSchema {
  const defs = (schema.definitions ?? {}) as Record<string, JsonSchema>;
  const walk = (node: unknown, depth: number): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, depth));
    if (!node || typeof node !== 'object') return node;
    const obj = { ...(node as Record<string, unknown>) };
    if (typeof obj.$ref === 'string') {
      const name = obj.$ref.replace('#/definitions/', '');
      const { $ref, ...rest } = obj;
      if (depth >= MAX_DEPTH || !defs[name]) return { ...rest, description: rest.description ?? `Recursive ${name}` };
      return { ...(walk(defs[name], depth + 1) as object), ...rest };
    }
    delete obj.definitions;
    for (const k of Object.keys(obj)) obj[k] = walk(obj[k], depth);
    return obj;
  };
  const { definitions, ...root } = schema;
  return walk(root, 0) as JsonSchema;
}

/** Self-contained JSON Schema for a function's arguments object (the "args" body field / MCP tool input). */
export function fnInputSchema(spec: contract.Spec, fn: string): JsonSchema {
  const full = spec.jsonSchema(fn) as JsonSchema;                    // { $schema, definitions, $ref: '#/definitions/<fn>' }
  const defs = full.definitions as Record<string, any>;
  const args = defs[fn]?.properties?.args ?? { type: 'object', properties: {}, additionalProperties: false };
  const out = inlineRefs({ definitions: defs, ...args }) as Record<string, unknown>;
  return { type: 'object', properties: (out.properties as object) ?? {}, ...(out.required ? { required: out.required } : {}), additionalProperties: false };
}

/** Self-contained schema of a UDT (struct/union/enum) by name. */
export function udtSchema(spec: contract.Spec, name: string): JsonSchema {
  const full = spec.jsonSchema() as JsonSchema;
  const defs = full.definitions as Record<string, any>;
  return inlineRefs({ definitions: defs, ...(defs[name] ?? {}) });
}
