import type { contract, xdr } from '@stellar/stellar-sdk';
import type { JsonSchema } from '../types.js';
import { renderType } from './render.js';

const MAX_DEPTH = 6;

const str = (v: unknown): string => (v == null ? '' : String(v));

// stellar-sdk 17.1 XDR unions are plain objects exposing both the arm-named own
// property (t.vec, t.map, t.option, ...) and a `.value` prototype getter that returns
// the same payload regardless of arm name (verified via node -e against the
// kitchen-sink fixture — see spec/codec.ts, which already relies on `.value`
// uniformly). We use `.value` here for the same reason: one accessor for every case.
type TypeDef = { type: string; value: any };
type Entry = { type: string; value: any };

function findUdtEntry(spec: contract.Spec, name: string): Entry | undefined {
  for (const e of spec.entries as unknown as Entry[]) {
    if (e.type.startsWith('scSpecEntryUdt') && str(e.value?.name) === name) return e;
  }
  return undefined;
}

function decimalSchema(name: string, unsigned: boolean): JsonSchema {
  return { type: 'string', pattern: unsigned ? '^[0-9]+$' : '^-?[0-9]+$', description: `${name} as a decimal string` };
}

function structSchema(v: any, spec: contract.Spec, depth: number): JsonSchema {
  const fields = (v.fields as any[]) ?? [];
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const f of fields) {
    const name = str(f.name);
    properties[name] = typeSchema(f.type, spec, depth);
    required.push(name);
  }
  const doc = str(v.doc);
  return { type: 'object', properties, required, additionalProperties: false, ...(doc ? { description: doc } : {}) };
}

function unionSchema(v: any, spec: contract.Spec, depth: number): JsonSchema {
  const cases = (v.cases as any[]) ?? [];
  const oneOf = cases.map((c): JsonSchema => {
    const name = str(c.value.name);
    if (c.type === 'scSpecUdtUnionCaseVoidV0') return { const: name };
    const types = (c.value.type as TypeDef[]) ?? [];
    const items = types.map((t) => typeSchema(t, spec, depth));
    return {
      type: 'object',
      properties: { tag: { const: name }, values: { type: 'array', items, minItems: items.length, maxItems: items.length } },
      required: ['tag', 'values'],
      additionalProperties: false
    };
  });
  const doc = str(v.doc);
  return { oneOf, ...(doc ? { description: doc } : {}) };
}

function enumSchema(v: any): JsonSchema {
  const cases = (v.cases as any[]) ?? [];
  const name = str(v.name);
  const desc = cases.map((c) => `${str(c.name)} = ${Number(c.value)}`).join(', ');
  return { type: 'integer', enum: cases.map((c) => Number(c.value)), description: `${name}: ${desc}` };
}

function errorEnumSchema(v: any): JsonSchema {
  const cases = (v.cases as any[]) ?? [];
  return { type: 'integer', enum: cases.map((c) => Number(c.value)) };
}

function resolveUdt(name: string, spec: contract.Spec, depth: number): JsonSchema {
  if (depth >= MAX_DEPTH) return { description: `Recursive ${name}` };
  const entry = findUdtEntry(spec, name);
  if (!entry) return {};
  switch (entry.type) {
    case 'scSpecEntryUdtStructV0': return structSchema(entry.value, spec, depth + 1);
    case 'scSpecEntryUdtUnionV0': return unionSchema(entry.value, spec, depth + 1);
    case 'scSpecEntryUdtEnumV0': return enumSchema(entry.value);
    case 'scSpecEntryUdtErrorEnumV0': return errorEnumSchema(entry.value);
    default: return {};
  }
}

/**
 * JSON Schema for one ScSpecTypeDef, derived directly from the spec's type tree — this
 * IS the JSON contract that spec/codec.ts implements (0x-hex bytes, decimal-string
 * big integers, maps as {key: value} objects). Do not derive this structurally from
 * contract.Spec.jsonSchema(): its output cannot distinguish Vec<(A,B)> from Map<A,B>
 * once both have been walked into plain JSON Schema, and it encodes bytes as base64
 * and maps as [k,v][] arrays — neither of which matches the runtime codec.
 */
function typeSchema(t: TypeDef, spec: contract.Spec, depth: number): JsonSchema {
  switch (t.type) {
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
      return { type: 'integer' };
    case 'scSpecTypeU64': return decimalSchema('u64', true);
    case 'scSpecTypeI64': return decimalSchema('i64', false);
    case 'scSpecTypeU128': return decimalSchema('u128', true);
    case 'scSpecTypeI128': return decimalSchema('i128', false);
    case 'scSpecTypeU256': return decimalSchema('u256', true);
    case 'scSpecTypeI256': return decimalSchema('i256', false);
    case 'scSpecTypeTimepoint': return decimalSchema('Timepoint', true);
    case 'scSpecTypeDuration': return decimalSchema('Duration', true);
    case 'scSpecTypeBool':
      return { type: 'boolean' };
    case 'scSpecTypeVoid':
      return { type: 'null' };
    case 'scSpecTypeAddress':
    case 'scSpecTypeMuxedAddress':
      return { type: 'string', description: 'Stellar address (G… or C…)' };
    case 'scSpecTypeSymbol':
    case 'scSpecTypeString':
      return { type: 'string' };
    case 'scSpecTypeBytes':
      return { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', description: 'Bytes as 0x-prefixed hex' };
    case 'scSpecTypeBytesN': {
      const n = Number(t.value.n);
      const len = 2 + 2 * n;
      return { type: 'string', pattern: `^0x[0-9a-fA-F]{${2 * n}}$`, minLength: len, maxLength: len, description: `BytesN<${n}> as 0x-prefixed hex` };
    }
    case 'scSpecTypeOption':
      return { anyOf: [typeSchema(t.value.valueType, spec, depth), { type: 'null' }] };
    case 'scSpecTypeVec':
      return { type: 'array', items: typeSchema(t.value.elementType, spec, depth) };
    case 'scSpecTypeMap': {
      const k = renderType(t.value.keyType as xdr.ScSpecTypeDef);
      const v = renderType(t.value.valueType as xdr.ScSpecTypeDef);
      return { type: 'object', additionalProperties: typeSchema(t.value.valueType, spec, depth), description: `Map<${k}, ${v}> as an object keyed by ${k}` };
    }
    case 'scSpecTypeTuple': {
      const items = (t.value.valueTypes as TypeDef[]).map((x) => typeSchema(x, spec, depth));
      return { type: 'array', items, minItems: items.length, maxItems: items.length };
    }
    case 'scSpecTypeResult':
      return typeSchema(t.value.okType, spec, depth);
    case 'scSpecTypeUdt':
      return resolveUdt(str(t.value.name), spec, depth);
    case 'scSpecTypeVal':
    default:
      return {};
  }
}

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
  const f = spec.getFunc(fn);
  const inputs = f.inputs as unknown as Array<{ name: unknown; type: TypeDef }>;
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const i of inputs) {
    const name = str(i.name);
    properties[name] = typeSchema(i.type, spec, 0);
    if (i.type.type !== 'scSpecTypeOption') required.push(name);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

/** Self-contained schema of a UDT (struct/union/enum) by name. */
export function udtSchema(spec: contract.Spec, name: string): JsonSchema {
  return resolveUdt(name, spec, 0);
}
