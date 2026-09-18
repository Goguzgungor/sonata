import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { FakeChain } from '../helpers/fakeChain.js';
import { FIXTURE_ID, loadFixtureWasm } from '../fixtures/index.js';

const gen = { llmsTxt: (m: any) => `# ${m.id}`, openapi: (m: any) => ({ openapi: '3.1.0', title: m.id }) };
let chain: FakeChain, reg: Registry, store: MemoryStore;
beforeEach(() => { chain = new FakeChain(); store = new MemoryStore(); reg = new Registry({ store, chain, gen }); });

describe('Registry.register', () => {
  it('rejects an invalid contract id', async () => {
    await expect(reg.register('nope', 'testnet')).rejects.toMatchObject({ status: 400, error: 'invalid_contract_id' });
  });
  it('returns queued immediately, then completes all steps', async () => {
    const first = await reg.register(FIXTURE_ID, 'testnet', 'Kitchen');
    expect(first.status).toBe('queued');
    await reg.whenIdle();
    const row = (await store.get(FIXTURE_ID))!;
    expect(row.status).toBe('ready');
    expect(row.steps.map((s) => [s.name, s.status])).toEqual([['fetch', 'done'], ['parse', 'done'], ['generate', 'done'], ['index', 'skipped']]);
    expect(row.steps[1].detail).toBe('16 functions · 4 types · 2 errors');
    expect(row.model!.functions).toHaveLength(16);
    expect(row.llmsTxt).toBe(`# ${FIXTURE_ID}`);
    expect(row.specXdr!.length).toBeGreaterThan(10);
  });
  it('is idempotent when the wasm hash is unchanged', async () => {
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const before = (await store.get(FIXTURE_ID))!;
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const after = (await store.get(FIXTURE_ID))!;
    expect(after.status).toBe('ready');
    expect(chain.calls.filter((c) => c.method === 'getContractWasm')).toHaveLength(2);
    expect(after.model).toEqual(before.model);
  });
  it('marks the failing step and the contract failed, with a readable error', async () => {
    chain.impl.getContractWasm = async () => Buffer.from('not wasm');
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const row = (await store.get(FIXTURE_ID))!;
    expect(row.status).toBe('failed');
    expect(row.steps[0].status).toBe('done');
    expect(row.steps[1]).toMatchObject({ name: 'parse', status: 'failed' });
    expect(row.error).toMatch(/No contract spec found/);
  });
  it('ready() throws 404 / 409 and returns model + spec when ready', async () => {
    await expect(reg.ready('CNOPE')).rejects.toMatchObject({ status: 404, error: 'contract_not_found' });
    chain.impl.getContractWasm = () => new Promise((r) => setTimeout(() => r(loadFixtureWasm()), 500)); // slow, so the row is still running
    await reg.register(FIXTURE_ID, 'testnet');
    await expect(reg.ready(FIXTURE_ID)).rejects.toMatchObject({ status: 409, error: 'contract_not_ready' });
  });
  it('learnHint updates the stored hint and the cached model', async () => {
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    await reg.learnHint(FIXTURE_ID, 'bump', 'write');
    const { model, spec } = await reg.ready(FIXTURE_ID);
    expect(model.functions.find((f) => f.name === 'bump')!.kind).toBe('write');
    expect(spec.getFunc('bump')).toBeTruthy();
    expect(await store.getHints(FIXTURE_ID)).toEqual({ bump: 'write' });
  });
  it('learnHint on an unknown contract is a 404, not a store error', async () => {
    await expect(reg.learnHint('CNOPE', 'bump', 'write')).rejects.toMatchObject({ status: 404, error: 'contract_not_found' });
    expect(await store.getHints('CNOPE')).toEqual({});
  });
});
