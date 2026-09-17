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
