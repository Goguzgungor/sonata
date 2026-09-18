import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';

const wasm = loadFixtureWasm();
const spec = contract.Spec.fromWasm(wasm);
const meta = { id: FIXTURE_ID, network: 'testnet' as const, name: null, wasmHash: wasmHashOf(wasm), specLedger: 100 };

describe('buildModel', () => {
  const m = buildModel(spec, meta);
  it('lists every function with signature parts, doc and schema', () => {
    expect(m.functions).toHaveLength(16);
    const add = m.functions.find((f) => f.name === 'add')!;
    expect(add.inputs).toEqual([{ name: 'a', type: 'i128' }, { name: 'b', type: 'i128' }]);
    expect(add.output).toBe('i128');
    expect(add.doc).toBe('Returns the sum of two i128 values.');
    expect((add.jsonSchema as any).required).toEqual(['a', 'b']);
  });
  it('collects types, errors and events', () => {
    expect(m.types.map((t) => [t.name, t.kind])).toEqual(expect.arrayContaining([['Pair', 'struct'], ['Shape', 'union'], ['Level', 'enum'], ['Nested', 'struct']]));
    expect(m.errors).toEqual([{ code: 1, name: 'TooBig', doc: 'The number was too big.' }, { code: 2, name: 'Forbidden', doc: 'Not allowed.' }]);
    expect(m.events).toEqual([{ name: 'Pinged', doc: 'Emitted by ping.', params: [{ name: 'who', type: 'Address' }, { name: 'n', type: 'u32' }] }]);
  });
  it('applies name hints, then learned hints override', () => {
    expect(m.functions.find((f) => f.name === 'get_count')!.kind).toBe('read');
    expect(m.functions.find((f) => f.name === 'bump')!.kind).toBe('unknown');
    const learned = buildModel(spec, meta, { bump: 'write', echo_map: 'read' });
    expect(learned.functions.find((f) => f.name === 'bump')!.kind).toBe('write');
    expect(learned.functions.find((f) => f.name === 'echo_map')!.kind).toBe('read');
  });
  it('wasmHashOf is a 64-char hex sha256', () => {
    expect(wasmHashOf(wasm)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is JSON-safe', () => {
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
