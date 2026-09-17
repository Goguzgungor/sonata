import type { xdr } from '@stellar/stellar-sdk';

const PRIM: Record<string, string> = {
  scSpecTypeVal: 'Val', scSpecTypeBool: 'bool', scSpecTypeVoid: 'void', scSpecTypeError: 'Error',
  scSpecTypeU32: 'u32', scSpecTypeI32: 'i32', scSpecTypeU64: 'u64', scSpecTypeI64: 'i64',
  scSpecTypeTimepoint: 'Timepoint', scSpecTypeDuration: 'Duration',
  scSpecTypeU128: 'u128', scSpecTypeI128: 'i128', scSpecTypeU256: 'u256', scSpecTypeI256: 'i256',
  scSpecTypeBytes: 'Bytes', scSpecTypeString: 'String', scSpecTypeSymbol: 'Symbol',
  scSpecTypeAddress: 'Address', scSpecTypeMuxedAddress: 'MuxedAddress',
};

// stellar-sdk 17.1 XDR unions are plain objects, but (verified via node -e against the
// kitchen-sink fixture) the payload lives under a property NAMED for the variant, not
// under a generic `.value`: { type: 'scSpecTypeVec', vec: { elementType } },
// { type: 'scSpecTypeOption', option: { valueType } }, { type: 'scSpecTypeBytesN', bytesN: { n } },
// { type: 'scSpecTypeUdt', udt: { name } }, { type: 'scSpecTypeResult', result: { okType, errorType } }, etc.
export function renderType(t: xdr.ScSpecTypeDef): string {
  const any = t as unknown as Record<string, any>;
  if (PRIM[any.type]) return PRIM[any.type];
  switch (any.type) {
    case 'scSpecTypeOption': return `Option<${renderType(any.option.valueType)}>`;
    case 'scSpecTypeResult': return `Result<${renderType(any.result.okType)}, ${renderType(any.result.errorType)}>`;
    case 'scSpecTypeVec': return `Vec<${renderType(any.vec.elementType)}>`;
    case 'scSpecTypeMap': return `Map<${renderType(any.map.keyType)}, ${renderType(any.map.valueType)}>`;
    case 'scSpecTypeTuple': return `(${(any.tuple.valueTypes as any[]).map(renderType).join(', ')})`;
    case 'scSpecTypeBytesN': return `BytesN<${any.bytesN.n}>`;
    case 'scSpecTypeUdt': return String(any.udt.name);
    default: return `unknown(${any.type})`;
  }
}

export function renderInputs(fn: xdr.ScSpecFunctionV0): Array<{ name: string; type: string }> {
  return (fn.inputs as any[]).map((i) => ({ name: String(i.name), type: renderType(i.type) }));
}

export function renderOutput(fn: xdr.ScSpecFunctionV0): string {
  const outs = fn.outputs as any[];
  return outs.length === 0 ? 'void' : renderType(outs[0]);
}

export function renderSignature(fn: xdr.ScSpecFunctionV0): string {
  const args = renderInputs(fn).map((i) => `${i.name}: ${i.type}`).join(', ');
  return `${String(fn.name)}(${args}) → ${renderOutput(fn)}`;
}
