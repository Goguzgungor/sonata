import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';
import { llmsTxt } from '../../src/docs/llms.js';

const wasm = loadFixtureWasm();
const model = buildModel(contract.Spec.fromWasm(wasm), { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink', wasmHash: wasmHashOf(wasm), specLedger: 0 });
const cfg = { publicBaseUrl: 'https://api.sonata.test' };

describe('llmsTxt', () => {
  const out = llmsTxt(model, cfg);
  it('has the documented sections in order', () => {
    const idx = ['# KitchenSink', '## Endpoints', '## Functions', '## Types', '## Errors', '## Events'].map((h) => out.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('renders signatures, docs, errors and the mcp url', () => {
    expect(out).toContain('add(a: i128, b: i128) → i128');
    expect(out).toContain('Returns the sum of two i128 values.');
    expect(out).toContain('1 TooBig · The number was too big.');
    expect(out).toContain(`https://api.sonata.test/c/${FIXTURE_ID}/mcp`);
    expect(out).toContain(`POST https://api.sonata.test/c/${FIXTURE_ID}/call/{fn}`);
  });
  it('falls back to the short id when unnamed', () => {
    expect(llmsTxt({ ...model, name: null }, cfg)).toMatch(/^# CAAA…BSC4/);
  });
  it('is stable', () => { expect(out).toMatchSnapshot(); });
});
