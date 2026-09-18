import { describe, it, expect } from 'vitest';
import { classifyByName } from '../../src/spec/hints.js';

describe('classifyByName', () => {
  it('reads by name', () => {
    expect(classifyByName('get_count', [])).toBe('read');
    expect(classifyByName('balance', [{ name: 'id', type: 'Address' }])).toBe('read');
    expect(classifyByName('allowance', [])).toBe('read');
    expect(classifyByName('total_supply', [])).toBe('read');
    expect(classifyByName('is_admin', [])).toBe('read');
    expect(classifyByName('balance_of', [])).toBe('read');
  });
  it('writes by signer-like Address input', () => {
    expect(classifyByName('transfer', [{ name: 'from', type: 'Address' }, { name: 'to', type: 'Address' }])).toBe('write');
    expect(classifyByName('set_admin', [{ name: 'admin', type: 'Address' }])).toBe('write');
  });
  it('unknown otherwise', () => {
    expect(classifyByName('echo_map', [{ name: 'm', type: 'Map<Symbol, i128>' }])).toBe('unknown');
    expect(classifyByName('bump', [])).toBe('unknown');
  });
});
