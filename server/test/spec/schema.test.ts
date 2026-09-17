import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { inlineRefs, fnInputSchema, udtSchema } from '../../src/spec/schema.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());

describe('inlineRefs', () => {
  it('replaces $ref with the definition and drops definitions', () => {
    const out = inlineRefs({ definitions: { A: { type: 'string' } }, type: 'object', properties: { x: { $ref: '#/definitions/A' } } });
    expect(out).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });
  it('keeps extra keys next to a $ref (BytesN maxLength)', () => {
    const out = inlineRefs({ definitions: { D: { type: 'string' } }, properties: { h: { $ref: '#/definitions/D', maxLength: 32 } } });
    expect(out).toEqual({ properties: { h: { type: 'string', maxLength: 32 } } });
  });
  it('stops on recursive refs', () => {
    const out = inlineRefs({ definitions: { N: { type: 'object', properties: { next: { $ref: '#/definitions/N' } } } }, $ref: '#/definitions/N' }) as any;
    expect(out.type).toBe('object');
    expect(JSON.stringify(out).length).toBeLessThan(2000);
  });
});

describe('fnInputSchema', () => {
  it('is a self-contained object schema of the args', () => {
    const s = fnInputSchema(spec, 'add') as any;
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['a', 'b']);
    expect(s.properties.a).toMatchObject({ type: 'string' });
    expect(JSON.stringify(s)).not.toContain('$ref');
  });
  it('makes Option args optional and inlines udts', () => {
    expect((fnInputSchema(spec, 'maybe') as any).required ?? []).toEqual([]);
    const p = fnInputSchema(spec, 'echo_pair') as any;
    expect(p.properties.p.properties.b).toMatchObject({ type: 'string' });
  });
  it('no-arg functions produce an empty object schema', () => {
    expect(fnInputSchema(spec, 'bump')).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  // Encodes the runtime codec's JSON contract (spec/codec.ts), not the SDK's own
  // Spec.jsonSchema() output — see the schema.ts module doc for why the two differ
  // (0x-hex bytes vs base64, decimal-string big ints vs number, {k:v} maps vs [k,v][]).
  it('i128 args are decimal strings, signed', () => {
    expect(fnInputSchema(spec, 'add').properties as any).toMatchObject({ a: { type: 'string', pattern: '^-?[0-9]+$' } });
  });
  it('Bytes args are 0x-hex', () => {
    const s = fnInputSchema(spec, 'echo_bytes') as any;
    expect(s.properties.b).toMatchObject({ type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$' });
  });
  it('BytesN<32> args are fixed-length 0x-hex', () => {
    const s = fnInputSchema(spec, 'echo_hash') as any;
    expect(s.properties.h).toMatchObject({ type: 'string', minLength: 66, maxLength: 66 });
  });
  it('Map args are objects keyed by K, valued by V’s schema', () => {
    const s = fnInputSchema(spec, 'echo_map') as any;
    expect(s.properties.m.type).toBe('object');
    expect(s.properties.m.additionalProperties).toMatchObject({ type: 'string', pattern: '^-?[0-9]+$' });
  });
  it('Option args are anyOf [T, null]', () => {
    const s = fnInputSchema(spec, 'maybe') as any;
    expect(Array.isArray(s.properties.v.anyOf)).toBe(true);
    expect(s.properties.v.anyOf).toContainEqual({ type: 'null' });
  });
  it('Tuple args are fixed-length arrays', () => {
    const s = fnInputSchema(spec, 'tuple') as any;
    expect(s.properties.t.type).toBe('array');
    expect(s.properties.t.minItems).toBe(2);
    expect(s.properties.t.maxItems).toBe(2);
  });
  it('never contains a $ref, for any fixture function', () => {
    for (const f of spec.funcs()) expect(JSON.stringify(fnInputSchema(spec, String(f.name)))).not.toContain('$ref');
  });
});

describe('udtSchema', () => {
  it('is self-contained for a struct (Pair)', () => {
    const s = udtSchema(spec, 'Pair') as any;
    const json = JSON.stringify(s);
    expect(json).not.toContain('$ref');
    expect(json).not.toContain('"definitions"');
    expect(s.properties.a).toBeDefined();
    expect(s.properties.b).toBeDefined();
  });
  it('preserves oneOf for a union (Shape) without forcing type: object', () => {
    const s = udtSchema(spec, 'Shape') as any;
    const json = JSON.stringify(s);
    expect(json).not.toContain('$ref');
    expect(json).not.toContain('"definitions"');
    expect(Array.isArray(s.oneOf)).toBe(true);
    expect(s.oneOf).toContainEqual({ const: 'Unit' });
    const boxed = s.oneOf.find((c: any) => c.properties?.tag?.const === 'Boxed');
    expect(boxed).toMatchObject({ type: 'object', properties: { tag: { const: 'Boxed' }, values: { type: 'array' } }, required: ['tag', 'values'] });
  });
  it('represents a C-style enum (Level) as an integer with the codec-compatible values, not oneOf', () => {
    // spec/codec.ts round-trips these enums as plain numbers (spec.nativeToScVal(2, levelType)),
    // so the schema must say integer, not the oneOf-of-consts shape the old SDK-derived
    // schema produced (which a codec-following client would have rejected as a string).
    const s = udtSchema(spec, 'Level') as any;
    const json = JSON.stringify(s);
    expect(json).not.toContain('$ref');
    expect(json).not.toContain('"definitions"');
    expect(s).toMatchObject({ type: 'integer', enum: [1, 2] });
  });
  it('returns an empty object for an unknown udt name (documents current behaviour)', () => {
    expect(udtSchema(spec, 'DoesNotExist')).toEqual({});
  });
  it('never contains a $ref, for every named udt in the fixture', () => {
    for (const name of ['Pair', 'Shape', 'Level']) expect(JSON.stringify(udtSchema(spec, name))).not.toContain('$ref');
  });
});
