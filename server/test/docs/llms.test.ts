import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';
import { exampleArgs, llmsTxt } from '../../src/docs/llms.js';
import { encodeArgs } from '../../src/spec/codec.js';

const wasm = loadFixtureWasm();
const spec = contract.Spec.fromWasm(wasm);
const model = buildModel(spec, { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink', wasmHash: wasmHashOf(wasm), specLedger: 0 });
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
  it('shows a curl example the server would actually accept', () => {
    const line = out.split('\n').find((l) => l.startsWith('curl '))!;
    const payload = JSON.parse(/-d '(.*)'$/.exec(line)![1]);
    expect(payload.args).toEqual({ a: '0', b: '0' });                                  // not the old, always-400 `{}`
    expect(() => encodeArgs(spec, model.functions[0].name, payload.args)).not.toThrow();
  });
  it('documents every JSON convention the codec implements', () => {
    for (const phrase of ['decimal strings', '0x-hex', 'maps are objects', 'enums are integers', '{tag, values}', 'tuples are arrays', 'Option'])
      expect(out).toContain(phrase);
  });
  it('builds args the codec accepts for every function in the fixture', () => {
    for (const f of model.functions) expect(() => encodeArgs(spec, f.name, exampleArgs(f.jsonSchema)), f.name).not.toThrow();
  });
  it('falls back to the short id when unnamed', () => {
    expect(llmsTxt({ ...model, name: null }, cfg)).toMatch(/^# CAAA…BSC4/);
  });
  it('labels a Stellar Asset Contract on the second line', () => {
    const line2 = llmsTxt({ ...model, sac: true }, cfg).split('\n')[2];
    expect(line2.startsWith('Stellar Asset Contract (SEP-41 token) · ')).toBe(true);
  });
  it('is stable', () => { expect(out).toMatchSnapshot(); });
});
