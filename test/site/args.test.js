import { describe, it, expect } from 'vitest';
import { placeholderFor, fieldKind, coerceArgs } from '@/lib/args';

const dec = { type: 'string', pattern: '^-?[0-9]+$', description: 'i128 as a decimal string' };
const addr = { type: 'string', description: 'Stellar address (G… or C…)' };
const bytes = { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', description: 'Bytes as 0x-prefixed hex' };
const map = { type: 'object', additionalProperties: dec };
const u32 = { type: 'integer', minimum: 0, maximum: 4294967295 };
// Option<T> as the API emits it: anyOf [T, null].
const optU64 = { anyOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'null' }] };
const optU32 = { anyOf: [u32, { type: 'null' }] };
const optAddr = { anyOf: [addr, { type: 'null' }] };
const optMap = { anyOf: [map, { type: 'null' }] };
const cEnum = { type: 'integer', enum: [7, 9], description: 'Level: Low = 7, High = 9' };
const unionVoid = { oneOf: [{ const: 'None' }, { const: 'All' }] };
const unionPayload = {
  oneOf: [
    { type: 'object', properties: { tag: { const: 'Deposit' }, values: { type: 'array', prefixItems: [dec] } }, required: ['tag', 'values'] },
    { const: 'None' }
  ]
};

describe('fieldKind / placeholderFor', () => {
  it('classifies schemas', () => {
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'integer' })).toBe('integer');
    expect(fieldKind(dec)).toBe('string');
    expect(fieldKind(map)).toBe('json');
    expect(fieldKind({ type: 'array', items: addr })).toBe('json');
    expect(fieldKind(unionPayload)).toBe('json');
  });
  it('Option<T> gets the widget of its inner arm', () => {
    expect(fieldKind(optU64)).toBe('string');
    expect(fieldKind(optU32)).toBe('integer');
    expect(fieldKind(optAddr)).toBe('string');
    expect(fieldKind(optMap)).toBe('json');
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
  it('an Option placeholder matches the widget it is shown in', () => {
    expect(placeholderFor(optU64)).toBe('0');
    expect(placeholderFor(optU32)).toBe('0');
    expect(placeholderFor(optAddr)).toBe('G…');
    expect(placeholderFor(optMap)).toBe('{}');
  });
  it('a C-style enum suggests its first declared case', () => {
    expect(placeholderFor(cEnum)).toBe(String(cEnum.enum[0]));
  });
  it('union placeholders are valid JSON', () => {
    expect(placeholderFor(unionVoid)).toBe('"None"');
    const p = placeholderFor(unionPayload);
    expect(() => JSON.parse(p)).not.toThrow();
    expect(JSON.parse(p)).toEqual({ tag: 'Deposit', values: [] });
  });
});

describe('coerceArgs', () => {
  const inputs = [
    { name: 'a', schema: dec, required: true },
    { name: 'n', schema: { type: 'integer' }, required: true },
    { name: 'ok', schema: { type: 'boolean' }, required: true },
    { name: 'm', schema: map, required: true },
    { name: 'v', schema: optMap, required: false }
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
    const { args } = coerceArgs(inputs, { a: '1', n: '1', ok: false, m: '{}', v: '{"k":"1"}' });
    expect(args.v).toEqual({ k: '1' });
  });
  it('blank optional string/integer fields are omitted, not sent as empty', () => {
    const opts = [
      { name: 's', schema: optU64, required: false },
      { name: 'i', schema: optU32, required: false },
      { name: 'addr', schema: optAddr, required: false }
    ];
    const { args, errors } = coerceArgs(opts, { s: '', i: '', addr: '' });
    expect(errors).toEqual({});
    expect(args).toEqual({});
    expect('s' in args).toBe(false);
    const filled = coerceArgs(opts, { s: '12', i: '3', addr: 'GABC' });
    expect(filled.args).toEqual({ s: '12', i: 3, addr: 'GABC' });
  });
});
