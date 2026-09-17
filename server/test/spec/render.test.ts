import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { renderType, renderSignature } from '../../src/spec/render.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());
const sig = (n: string) => renderSignature(spec.getFunc(n));

describe('renderSignature', () => {
  it('renders primitives, containers and udts', () => {
    expect(sig('add')).toBe('add(a: i128, b: i128) → i128');
    expect(sig('echo_map')).toBe('echo_map(m: Map<Symbol, i128>) → Map<Symbol, i128>');
    expect(sig('echo_hash')).toBe('echo_hash(h: BytesN<32>) → BytesN<32>');
    expect(sig('echo_pair')).toBe('echo_pair(p: Pair) → Pair');
    expect(sig('maybe')).toBe('maybe(v: Option<u64>) → Option<u64>');
    expect(sig('list')).toBe('list(v: Vec<Address>) → u32');
    expect(sig('tuple')).toBe('tuple(t: (u32, bool)) → (u32, bool)');
    expect(sig('checked')).toBe('checked(n: u32) → Result<u32, Error>');
    expect(sig('ping')).toBe('ping(who: Address, n: u32) → void');
    expect(sig('bump')).toBe('bump() → u32');
  });
  it('renderType handles every input type in the fixture', () => {
    for (const f of spec.funcs()) for (const i of f.inputs) expect(renderType(i.type)).not.toMatch(/unknown/);
  });
});
