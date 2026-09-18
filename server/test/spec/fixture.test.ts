import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';

describe('fixture wasm', () => {
  it('contains a SEP-48 spec with the expected functions', () => {
    const spec = contract.Spec.fromWasm(loadFixtureWasm());
    const names = spec.funcs().map((f) => f.name.toString()).sort();
    expect(names).toEqual(['add', 'bump', 'checked', 'echo_bytes', 'echo_hash', 'echo_level', 'echo_map', 'echo_nested', 'echo_pair', 'echo_shape', 'get_count', 'list', 'maybe', 'ping', 'text', 'tuple']);
    expect(spec.errorCases().map((c) => [c.name.toString(), c.value])).toEqual([['TooBig', 1], ['Forbidden', 2]]);
  });
});
