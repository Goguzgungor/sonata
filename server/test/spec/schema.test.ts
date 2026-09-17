import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { inlineRefs, fnInputSchema } from '../../src/spec/schema.js';

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
});
