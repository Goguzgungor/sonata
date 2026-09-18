import { contract, xdr } from '@stellar/stellar-sdk';
import { ApiError } from '../errors.js';
import type { ContractModel } from '../types.js';

type TypeDef = { type: string; value: any };
type Entry = { type: string; value: any };
type Field = { name: unknown; type: TypeDef };
type UnionCase = { type: string; value: { name: unknown; type?: TypeDef[] } };
const HEX = /^0x([0-9a-fA-F]{2})*$/;
/** Same cap and meaning as spec/schema.ts: at most this many nested UDT resolutions before values pass through untouched. */
const MAX_DEPTH = 6;

export class CodecError extends ApiError {
  constructor(message: string, path: string) { super(400, 'invalid_args', message, { details: { path } }); }
}

const str = (v: unknown): string => (v == null ? '' : String(v));

// stellar-sdk 17.1 XDR unions are plain objects exposing both the arm-named own property and a
// `.value` prototype getter returning the same payload; we use `.value` uniformly (see spec/schema.ts).
function udtEntry(spec: contract.Spec, t: TypeDef): Entry | undefined {
  try { return spec.findEntry(str(t.value.name)) as unknown as Entry; } catch { return undefined; }
}
const isTupleStruct = (fields: Field[]) => fields.length > 0 && fields.every((f) => /^\d+$/.test(str(f.name)));

// Probed against the kitchen-sink fixture (stellar-sdk 17.1, node -e):
//   spec.nativeToScVal('Unit', shapeType)          -> throws "no such enum entry: undefined"
//   spec.nativeToScVal({ tag: 'Unit' }, shapeType) -> OK; scValToNative back gives { tag: 'Unit' } (no `values` key at all)
//   spec.nativeToScVal({ tag: 'Boxed', values: [3, 'hi'] }, shapeType) -> OK both ways, unchanged shape
//   spec.nativeToScVal(2, levelType)  -> OK (C enum takes/returns the plain number, no translation needed)
//   spec.nativeToScVal('High', levelType) -> throws "expected number for enum Level, but got string"
// So only the union *void* case needs translating: JSON input 'Unit' -> SDK input { tag: 'Unit' },
// and SDK output { tag: 'Unit' } (no `values`) -> JSON output 'Unit'. C-style enums need no translation.
//
// The SDK's own udt conversion is *not* type-directed past the udt boundary in the ways this API
// documents: nativeToStruct/nativeToUnion call nativeToScVal per field/case value, which base64-decodes
// a string for Bytes/BytesN and rejects an object for Map. So fromJson/shapeOutput recurse into struct
// fields and union case tuples themselves, applying the same JSON contract at every level.

function structFromJson(v: unknown, sv: any, path: string, spec: contract.Spec, depth: number): unknown {
  const fields = (sv.fields as Field[]) ?? [];
  if (isTupleStruct(fields)) {
    if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
    return v.map((x, i) => (fields[i] ? fromJson(x, fields[i].type, `${path}[${i}]`, spec, depth) : x));
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new CodecError(`${path}: expected object`, path);
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const name = str(f.name);
    const at = `${path}.${name}`;
    if (!(name in o) && f.type.type !== 'scSpecTypeOption') throw new CodecError(`${at}: missing`, at);
    out[name] = fromJson(o[name], f.type, at, spec, depth);
  }
  return out;
}

function unionFromJson(v: unknown, uv: any, path: string, spec: contract.Spec, depth: number): unknown {
  const cases = (uv.cases as UnionCase[]) ?? [];
  const tag = typeof v === 'string' ? v : v && typeof v === 'object' && 'tag' in v ? str((v as { tag: unknown }).tag) : null;
  if (tag === null) throw new CodecError(`${path}: expected a case name or { tag, values }`, path);
  const c = cases.find((x) => str(x.value.name) === tag);
  if (!c) throw new CodecError(`${path}: unknown case ${tag}`, path);
  if (c.type === 'scSpecUdtUnionCaseVoidV0') return { tag };
  const types = c.value.type ?? [];
  const values = (v as { values?: unknown }).values;
  if (!Array.isArray(values)) throw new CodecError(`${path}: case ${tag} expects { tag, values }`, path);
  return { tag, values: values.map((x, i) => (types[i] ? fromJson(x, types[i], `${path}.values[${i}]`, spec, depth) : x)) };
}

/** JSON input → the shapes Spec.nativeToScVal accepts (Uint8Array for bytes, [k,v][] for maps). Type-directed. */
function fromJson(v: unknown, t: TypeDef, path: string, spec: contract.Spec, depth = 0): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : fromJson(v, t.value.valueType, path, spec, depth);
    case 'scSpecTypeBytes':
    case 'scSpecTypeBytesN': {
      if (typeof v !== 'string' || !HEX.test(v)) throw new CodecError(`${path}: expected 0x-prefixed hex string`, path);
      const bytes = Buffer.from(v.slice(2), 'hex');
      if (t.type === 'scSpecTypeBytesN' && bytes.length !== t.value.n) throw new CodecError(`${path}: expected ${t.value.n} bytes, got ${bytes.length}`, path);
      return new Uint8Array(bytes);
    }
    case 'scSpecTypeVec':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.elementType, `${path}[${i}]`, spec, depth));
    case 'scSpecTypeTuple':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.valueTypes[i], `${path}[${i}]`, spec, depth));
    case 'scSpecTypeMap': {
      const pairs: Array<[unknown, unknown]> = Array.isArray(v) ? (v as Array<[unknown, unknown]>)
        : v && typeof v === 'object' ? Object.entries(v as object) : (() => { throw new CodecError(`${path}: expected object`, path); })();
      return pairs.map(([k, val]) => [fromJson(k, t.value.keyType, `${path}.key`, spec, depth), fromJson(val, t.value.valueType, `${path}.${String(k)}`, spec, depth)]);
    }
    case 'scSpecTypeUdt': {
      const entry = udtEntry(spec, t);
      if (!entry || depth >= MAX_DEPTH) return v;                     // unknown or too deep → leave to nativeToScVal
      switch (entry.type) {
        case 'scSpecEntryUdtStructV0': return structFromJson(v, entry.value, path, spec, depth + 1);
        case 'scSpecEntryUdtUnionV0': return unionFromJson(v, entry.value, path, spec, depth + 1);
        default: return v;                                            // C-style / error enums are plain integers
      }
    }
    default: return v; // ints (string|number), bool, Address string, Symbol/String — handled by nativeToScVal
  }
}

/** Native output of Spec.scValToNative → JSON-safe. */
export function toJson(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex');
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(toJson(k)), toJson(x)]));
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('unwrap' in o && typeof o.unwrap === 'function' && 'isOk' in o) { // rust_result Ok/Err from funcResToNative
      return (o as any).isOk() ? toJson((o as any).unwrap()) : { error: toJson((o as any).unwrapErr()) };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toJson(x)]));
  }
  return v;
}

function structToJson(v: unknown, sv: any, spec: contract.Spec, depth: number): unknown {
  const fields = (sv.fields as Field[]) ?? [];
  if (Array.isArray(v)) return v.map((x, i) => (fields[i] ? shapeOutput(x, fields[i].type, spec, depth) : toJson(x)));   // tuple-like struct
  if (!v || typeof v !== 'object') return toJson(v);
  const o = v as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [str(f.name), shapeOutput(o[str(f.name)], f.type, spec, depth)]));
}

function unionToJson(v: unknown, uv: any, spec: contract.Spec, depth: number): unknown {
  if (!v || typeof v !== 'object' || !('tag' in v)) return toJson(v);
  const o = v as { tag: unknown; values?: unknown };
  const tag = str(o.tag);
  const c = ((uv.cases as UnionCase[]) ?? []).find((x) => str(x.value.name) === tag);
  if (!c || c.type === 'scSpecUdtUnionCaseVoidV0') return tag;         // void case → the bare name
  const types = c.value.type ?? [];
  const values = Array.isArray(o.values) ? o.values : [];
  return { tag, values: values.map((x, i) => (types[i] ? shapeOutput(x, types[i], spec, depth) : toJson(x))) };
}

/** scValToNative returns maps as [k,v][]; rebuild objects type-directed so Vec<Tuple> stays an array. */
function shapeOutput(v: unknown, t: TypeDef, spec: contract.Spec, depth = 0): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : shapeOutput(v, t.value.valueType, spec, depth);
    case 'scSpecTypeMap': return Object.fromEntries((v as Array<[unknown, unknown]>).map(([k, x]) => [String(toJson(k)), shapeOutput(x, t.value.valueType, spec, depth)]));
    case 'scSpecTypeVec': return (v as unknown[]).map((x) => shapeOutput(x, t.value.elementType, spec, depth));
    case 'scSpecTypeTuple': return (v as unknown[]).map((x, i) => shapeOutput(x, t.value.valueTypes[i], spec, depth));
    case 'scSpecTypeResult': return toJson(v);
    case 'scSpecTypeUdt': {
      const entry = udtEntry(spec, t);
      if (!entry || depth >= MAX_DEPTH) return toJson(v);
      switch (entry.type) {
        case 'scSpecEntryUdtStructV0': return structToJson(v, entry.value, spec, depth + 1);
        case 'scSpecEntryUdtUnionV0': return unionToJson(v, entry.value, spec, depth + 1);
        default: return toJson(v);                                     // C-style / error enums are plain integers
      }
    }
    default: return toJson(v);
  }
}

export function encodeArgs(spec: contract.Spec, fn: string, args: Record<string, unknown>): xdr.ScVal[] {
  const f = spec.getFunc(fn);
  const inputs = f.inputs as unknown as Array<{ name: unknown; type: TypeDef }>;
  const out: xdr.ScVal[] = [];
  for (const i of inputs) {
    const name = String(i.name);
    if (!(name in args) && i.type.type !== 'scSpecTypeOption') throw new CodecError(`${name}: missing`, name);
    const prepared = fromJson(args[name], i.type, name, spec);
    try {
      out.push(spec.nativeToScVal(prepared, i.type as unknown as xdr.ScSpecTypeDef));
    } catch (e) {
      throw new CodecError(`${name}: ${(e as Error).message}`, name);
    }
  }
  return out;
}

export function decodeResult(spec: contract.Spec, fn: string, retval: xdr.ScVal): unknown {
  const f = spec.getFunc(fn);
  const outs = f.outputs as unknown as TypeDef[];
  if (outs.length === 0) return null;
  const native = spec.funcResToNative(fn, retval);
  const t = outs[0].type === 'scSpecTypeResult' ? outs[0].value.okType : outs[0];
  return shapeOutput(native && typeof native === 'object' && 'isOk' in native ? toJson(native) : native, t, spec);
}

export function contractErrorName(spec: contract.Spec, code: number): string | null {
  const c = (spec.errorCases() as unknown as Array<{ name: unknown; value: number }>).find((x) => Number(x.value) === code);
  return c ? String(c.name) : null;
}

/** Rethrows `e`; if it is a `contract_error` ApiError whose code the spec names, rethrows it renamed (error = spec name, message = the error's doc or the original message). */
export function namedContractError(e: unknown, model: ContractModel, spec: contract.Spec): never {
  if (e instanceof ApiError && e.error === 'contract_error' && e.extra.code !== undefined) {
    const name = contractErrorName(spec, e.extra.code);
    if (name) {
      const doc = model.errors.find((x) => x.code === e.extra.code)?.doc;
      throw new ApiError(422, name, doc || e.message, { code: e.extra.code, details: e.extra.details });
    }
  }
  throw e;
}
