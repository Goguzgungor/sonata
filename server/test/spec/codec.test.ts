import { describe, it, expect } from 'vitest';
import { contract, xdr } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { encodeArgs, decodeResult, contractErrorName, toJson } from '../../src/spec/codec.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// round-trip helper: encode the single arg, then decode it as if it were the (echo) function's return value
const rt = (fn: string, args: Record<string, unknown>) => decodeResult(spec, fn, encodeArgs(spec, fn, args)[0]);

describe('encode/decode round trips', () => {
  it('i128 as decimal strings, numbers accepted', () => {
    const [a, b] = encodeArgs(spec, 'add', { a: '170141183460469231731687303715884105727', b: 5 });
    expect(a.type).toBe('scvI128');
    expect(toJson(spec.scValToNative(a, spec.getFunc('add').inputs[0].type))).toBe('170141183460469231731687303715884105727');
    expect(b.type).toBe('scvI128');
  });
  it('map object ⇄ object', () => {
    expect(rt('echo_map', { m: { alpha: '1', beta: '-2' } })).toEqual({ alpha: '1', beta: '-2' });
  });
  it('bytes hex ⇄ hex', () => {
    expect(rt('echo_bytes', { b: '0xdeadbeef' })).toBe('0xdeadbeef');
    expect(rt('echo_hash', { h: '0x' + 'ab'.repeat(32) })).toBe('0x' + 'ab'.repeat(32));
  });
  it('struct, union, enum, option, vec, string, tuple', () => {
    expect(rt('echo_pair', { p: { a: '7', b: G } })).toEqual({ a: '7', b: G });
    expect(rt('echo_shape', { s: 'Unit' })).toEqual('Unit');
    expect(rt('echo_shape', { s: { tag: 'Boxed', values: [3, 'hi'] } })).toEqual({ tag: 'Boxed', values: [3, 'hi'] });
    expect(rt('echo_level', { l: 2 })).toBe(2);
    expect(rt('maybe', { v: null })).toBeNull();
    expect(rt('maybe', { v: '42' })).toBe('42');
    expect(rt('text', { s: 'hello' })).toBe('hello');
    expect(rt('tuple', { t: [9, true] })).toEqual([9, true]);
    expect(encodeArgs(spec, 'list', { v: [G, G] })[0].type).toBe('scvVec');
  });
  it('decodes void as null', () => {
    expect(decodeResult(spec, 'ping', xdr.ScVal.scvVoid())).toBeNull();
  });
  it('decodes a Result Ok as the bare ok value', () => {
    expect(decodeResult(spec, 'checked', xdr.ScVal.scvU32(7))).toBe(7);
  });
});

describe('nested udt fields (recursion into struct fields and union case tuples)', () => {
  // Regression: the SDK's own nativeToStruct/nativeToUnion are not type-directed the way this API
  // documents — a Bytes field given as 0x-hex would be base64-decoded, a Map field given as an object
  // rejected, and a union void case given as its bare name rejected. See spec/codec.ts.
  const unit = { blob: '0xcafe', meta: { a: '1' }, shape: 'Unit', id: '0xdeadbeef' };
  const boxed = { blob: '0xcafe', meta: { a: '1' }, shape: { tag: 'Boxed', values: [3, 'hi'] }, id: '0xdeadbeef' };
  it('round-trips bytes, bytesN, map and a union void case inside a struct', () => {
    expect(rt('echo_nested', { n: unit })).toEqual(unit);
  });
  it('round-trips a union tuple case inside a struct', () => {
    expect(rt('echo_nested', { n: boxed })).toEqual(boxed);
  });
  it('encodes the documented hex, not base64, for a nested Bytes field', () => {
    const scv = encodeArgs(spec, 'echo_nested', { n: unit })[0] as any;   // scvMap of the struct's fields
    const blob = scv.value.find((e: any) => String(e.key.value) === 'blob').val;
    expect(blob.type).toBe('scvBytes');
    expect(Buffer.from(blob.value.value).toString('hex')).toBe('cafe');   // not base64('0xcafe')
  });
  it('names the failing nested path', () => {
    expect(() => encodeArgs(spec, 'echo_nested', { n: { ...unit, blob: 'cafe' } }))
      .toThrow(expect.objectContaining({ status: 400, extra: { details: { path: 'n.blob' } } }));
    expect(() => encodeArgs(spec, 'echo_nested', { n: { ...unit, shape: 'Nope' } })).toThrow(/n.shape: unknown case Nope/);
    const { id, ...missing } = unit;
    expect(() => encodeArgs(spec, 'echo_nested', { n: missing })).toThrow(/n.id: missing/);
  });
  it('stops recursing past MAX_DEPTH (hand-built self-referential spec)', () => {
    // The fixture has no self-referential type, so the cap is exercised against a spec built here:
    // `struct Recur { blob: Bytes, next: Option<Recur> }` with `recur(r: Recur) -> Recur`.
    const udt = xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name: 'Recur' } as any));
    const entries = [
      xdr.ScSpecEntry.scSpecEntryUdtStructV0(new xdr.ScSpecUdtStructV0({
        doc: '', lib: '', name: 'Recur' as any,
        fields: [
          new xdr.ScSpecUdtStructFieldV0({ doc: '', name: 'blob' as any, type: xdr.ScSpecTypeDef.scSpecTypeBytes() }),
          new xdr.ScSpecUdtStructFieldV0({ doc: '', name: 'next' as any, type: xdr.ScSpecTypeDef.scSpecTypeOption(new xdr.ScSpecTypeOption({ valueType: udt })) })
        ]
      })),
      xdr.ScSpecEntry.scSpecEntryFunctionV0(new xdr.ScSpecFunctionV0({
        doc: '', name: 'recur' as any, inputs: [new xdr.ScSpecFunctionInputV0({ doc: '', name: 'r' as any, type: udt })], outputs: [udt]
      }))
    ];
    const deep = new contract.Spec(entries);
    const nest = (n: number): any => (n === 0 ? null : { blob: '0xcafe', next: nest(n - 1) });
    const innermost = (v: any) => { let d = v; while (d?.next) d = d.next; return d.blob; };
    const run = (n: number) => decodeResult(deep, 'recur', encodeArgs(deep, 'recur', { r: nest(n) })[0]);
    expect(innermost(run(6))).toBe('0xcafe');                  // within the cap: every level is type-directed
    expect(innermost(run(7))).not.toBe('0xcafe');              // past it: the value is handed to the SDK untouched
  });
});

describe('errors', () => {
  it('names invalid args with a path', () => {
    expect(() => encodeArgs(spec, 'add', { a: 'x', b: '1' })).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args' }));
    expect(() => encodeArgs(spec, 'add', { a: '1' })).toThrow(/b/);
    expect(() => encodeArgs(spec, 'echo_hash', { h: '0xab' })).toThrow(/32/);
  });
  it('maps contract error codes to names', () => {
    expect(contractErrorName(spec, 1)).toBe('TooBig');
    expect(contractErrorName(spec, 9)).toBeNull();
  });
  it('names the exact failing argument, not a guess', () => {
    expect(() => encodeArgs(spec, 'add', { a: '1', b: 'x' })).toThrow(expect.objectContaining({ extra: { details: { path: 'b' } } }));
    expect(() => encodeArgs(spec, 'add', { a: 'x', b: '1' })).toThrow(expect.objectContaining({ extra: { details: { path: 'a' } } }));
  });
});
