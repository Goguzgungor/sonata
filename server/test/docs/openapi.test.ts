import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';
import { openapi } from '../../src/docs/openapi.js';

const wasm = loadFixtureWasm();
const model = buildModel(contract.Spec.fromWasm(wasm), { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink', wasmHash: wasmHashOf(wasm), specLedger: 0 });
const doc = openapi(model, { publicBaseUrl: 'https://api.sonata.test' }) as any;

describe('openapi', () => {
  it('is 3.1 with a server and a call + tx path per function', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://api.sonata.test' }]);
    expect(Object.keys(doc.paths).filter((p) => p.includes('/call/'))).toHaveLength(15);
    expect(Object.keys(doc.paths).filter((p) => p.includes('/tx/'))).toHaveLength(15);
    expect(doc.paths[`/c/${FIXTURE_ID}/submit`].post).toBeTruthy();
    expect(doc.paths[`/c/${FIXTURE_ID}/status`].get).toBeTruthy();
    expect(doc.paths[`/c/${FIXTURE_ID}/llms.txt`].get).toBeTruthy();
  });
  it('embeds the arg schema and shared error envelope', () => {
    const call = doc.paths[`/c/${FIXTURE_ID}/call/add`].post;
    expect(call.requestBody.content['application/json'].schema.properties.args.required).toEqual(['a', 'b']);
    expect(call.responses['422'].content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
    expect(doc.components.schemas.Error.required).toEqual(['error', 'message']);
    expect(doc.components.schemas.Pair).toBeTruthy();
  });
  it('is stable', () => { expect(doc).toMatchSnapshot(); });
});
