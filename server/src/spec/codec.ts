import { contract, xdr } from '@stellar/stellar-sdk';
import { ApiError } from '../errors.js';

type TypeDef = { type: string; value: any };
const HEX = /^0x([0-9a-fA-F]{2})*$/;

export class CodecError extends ApiError {
  constructor(message: string, path: string) { super(400, 'invalid_args', message, { details: { path } }); }
}

// Probed against the kitchen-sink fixture (stellar-sdk 17.1, node -e):
//   spec.nativeToScVal('Unit', shapeType)          -> throws "no such enum entry: undefined"
//   spec.nativeToScVal({ tag: 'Unit' }, shapeType) -> OK; scValToNative back gives { tag: 'Unit' } (no `values` key at all)
//   spec.nativeToScVal({ tag: 'Boxed', values: [3, 'hi'] }, shapeType) -> OK both ways, unchanged shape
//   spec.nativeToScVal(2, levelType)  -> OK (C enum takes/returns the plain number, no translation needed)
//   spec.nativeToScVal('High', levelType) -> throws "expected number for enum Level, but got string"
// So only the union *void* case needs translating: JSON input 'Unit' -> SDK input { tag: 'Unit' },
// and SDK output { tag: 'Unit' } (no `values`) -> JSON output 'Unit'. C-style enums need no translation.
function isUnionUdt(spec: contract.Spec, t: TypeDef): boolean {
  const name = String(t.value.name);
  const entry = spec.findEntry(name) as unknown as { type: string };
  return entry.type === 'scSpecEntryUdtUnionV0';
}

/** JSON input → the shapes Spec.nativeToScVal accepts (Uint8Array for bytes, [k,v][] for maps). Type-directed. */
function fromJson(v: unknown, t: TypeDef, path: string, spec: contract.Spec): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : fromJson(v, t.value.valueType, path, spec);
    case 'scSpecTypeBytes':
    case 'scSpecTypeBytesN': {
      if (typeof v !== 'string' || !HEX.test(v)) throw new CodecError(`${path}: expected 0x-prefixed hex string`, path);
      const bytes = Buffer.from(v.slice(2), 'hex');
      if (t.type === 'scSpecTypeBytesN' && bytes.length !== t.value.n) throw new CodecError(`${path}: expected ${t.value.n} bytes, got ${bytes.length}`, path);
      return new Uint8Array(bytes);
    }
    case 'scSpecTypeVec':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.elementType, `${path}[${i}]`, spec));
    case 'scSpecTypeTuple':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.valueTypes[i], `${path}[${i}]`, spec));
    case 'scSpecTypeMap': {
      const pairs: Array<[unknown, unknown]> = Array.isArray(v) ? (v as Array<[unknown, unknown]>)
        : v && typeof v === 'object' ? Object.entries(v as object) : (() => { throw new CodecError(`${path}: expected object`, path); })();
      return pairs.map(([k, val]) => [fromJson(k, t.value.keyType, `${path}.key`, spec), fromJson(val, t.value.valueType, `${path}.${String(k)}`, spec)]);
    }
    case 'scSpecTypeUdt':
      // Union void case: JSON allows the bare name ('Unit'); the SDK requires { tag: 'Unit' }.
      if (typeof v === 'string' && isUnionUdt(spec, t)) return { tag: v };
      return v; // structs → plain object, enum → number, tuple-case unions → {tag, values} — all handled by nativeToScVal
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

/** scValToNative returns maps as [k,v][]; rebuild objects type-directed so Vec<Tuple> stays an array. */
function shapeOutput(v: unknown, t: TypeDef, spec: contract.Spec): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : shapeOutput(v, t.value.valueType, spec);
    case 'scSpecTypeMap': return Object.fromEntries((v as Array<[unknown, unknown]>).map(([k, x]) => [String(toJson(k)), shapeOutput(x, t.value.valueType, spec)]));
    case 'scSpecTypeVec': return (v as unknown[]).map((x) => shapeOutput(x, t.value.elementType, spec));
    case 'scSpecTypeTuple': return (v as unknown[]).map((x, i) => shapeOutput(x, t.value.valueTypes[i], spec));
    case 'scSpecTypeResult': return toJson(v);
    case 'scSpecTypeUdt':
      // Union void case: the SDK decodes to { tag: 'Unit' } (no `values` key at all); normalise to the bare name.
      if (v && typeof v === 'object' && 'tag' in v && !('values' in v) && isUnionUdt(spec, t)) return toJson((v as { tag: unknown }).tag);
      return toJson(v);
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
