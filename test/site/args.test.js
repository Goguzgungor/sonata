import { describe, it, expect } from 'vitest';
import { placeholderFor, fieldKind, coerceArgs } from '@/lib/args';

const dec = { type: 'string', pattern: '^-?[0-9]+$', description: 'i128 as a decimal string' };
const addr = { type: 'string', description: 'Stellar address (G… or C…)' };
const bytes = { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', description: 'Bytes as 0x-prefixed hex' };
const map = { type: 'object', additionalProperties: dec };
const opt = { anyOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'null' }] };

describe('fieldKind / placeholderFor', () => {
  it('classifies schemas', () => {
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'integer' })).toBe('integer');
    expect(fieldKind(dec)).toBe('string');
    expect(fieldKind(map)).toBe('json');
    expect(fieldKind({ type: 'array', items: addr })).toBe('json');
    expect(fieldKind(opt)).toBe('json');
  });
  it('placeholders follow the JSON contract', () => {
    expect(placeholderFor(dec)).toBe('0');
    expect(placeholderFor(addr)).toBe('G…');
    expect(placeholderFor(bytes)).toBe('0x…');
    expect(placeholderFor(map)).toBe('{}');
    expect(placeholderFor({ type: 'array', items: addr })).toBe('[]');
    expect(placeholderFor({ type: 'integer' })).toBe('0');
    expect(placeholderFor({ type: 'string' })).toBe('text');
  });
});

describe('coerceArgs', () => {
  const inputs = [
    { name: 'a', schema: dec, required: true },
    { name: 'n', schema: { type: 'integer' }, required: true },
    { name: 'ok', schema: { type: 'boolean' }, required: true },
    { name: 'm', schema: map, required: true },
    { name: 'v', schema: opt, required: false }
  ];
  it('coerces per kind and omits empty optionals', () => {
    const { args, errors } = coerceArgs(inputs, { a: '12', n: '7', ok: true, m: '{"x":"1"}', v: '' });
    expect(errors).toEqual({});
    expect(args).toEqual({ a: '12', n: 7, ok: true, m: { x: '1' } });
  });
  it('reports missing required and bad JSON/number by field', () => {
    const { errors } = coerceArgs(inputs, { a: '', n: 'x', ok: false, m: '{bad', v: '' });
    expect(errors.a).toMatch(/required/i);
    expect(errors.n).toMatch(/integer/i);
    expect(errors.m).toMatch(/JSON/);
  });
  it('json optional with a value is parsed', () => {
    const { args } = coerceArgs(inputs, { a: '1', n: '1', ok: false, m: '{}', v: '"5"' });
    expect(args.v).toBe('5');
  });
});
