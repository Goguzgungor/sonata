import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { FakeChain } from '../helpers/fakeChain.js';
import { StrKey } from '@stellar/stellar-sdk';
import { FIXTURE_ID, loadFixtureWasm } from '../fixtures/index.js';

// Both generators read the *name*, so a regenerate-on-rename is observable in the stored documents.
const gen = { llmsTxt: (m: any) => `# ${m.name ?? m.id}`, openapi: (m: any) => ({ openapi: '3.1.0', title: m.name ?? m.id }) };
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
    expect(row.llmsTxt).toBe('# Kitchen');
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
  it('re-registering with a new name and an unchanged wasm hash still regenerates the docs', async () => {
    await reg.register(FIXTURE_ID, 'testnet', 'Old'); await reg.whenIdle();
    await reg.register(FIXTURE_ID, 'testnet', 'New'); await reg.whenIdle();
    const row = (await store.get(FIXTURE_ID))!;
    expect(row.steps.map((s) => s.detail)).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged']);   // the cheap path ran
    expect(row.name).toBe('New');
    expect(row.model!.name).toBe('New');
    expect(row.llmsTxt).toBe('# New');
    expect((row.openapi as any).title).toBe('New');
    expect((await reg.ready(FIXTURE_ID)).model.name).toBe('New');   // and the cache is not serving the old model
  });
});

describe('Registry.rename', () => {
  it('rewrites the name in the row, the model and both generated documents', async () => {
    await reg.register(FIXTURE_ID, 'testnet', 'Old'); await reg.whenIdle();
    const row = await reg.rename(FIXTURE_ID, 'Renamed');
    expect(row).toMatchObject({ name: 'Renamed', llmsTxt: '# Renamed' });
    expect(row.model!.name).toBe('Renamed');
    expect((row.openapi as any).title).toBe('Renamed');
    expect((await reg.ready(FIXTURE_ID)).model.name).toBe('Renamed');
  });
  it('is a 404 for an unknown contract', async () => {
    await expect(reg.rename('CNOPE', 'x')).rejects.toMatchObject({ status: 404, error: 'contract_not_found' });
  });
});

describe('Registry cache', () => {
  // The cache held a contract.Spec + model per contract forever; a public registry can hold far more
  // contracts than fit in memory, so it is a bounded LRU (review finding I7).
  const idFor = (byte: number) => StrKey.encodeContract(Buffer.alloc(32, byte));
  it('evicts the least recently used entry past the cap and re-hydrates it from the store', async () => {
    const small = new Registry({ store, chain, gen }, { cacheMax: 2 });
    const [a, b, c] = [idFor(1), idFor(2), idFor(3)];
    for (const id of [a, b, c]) { await small.register(id, 'testnet', id.slice(0, 5)); }
    await small.whenIdle();
    const specA = (await small.ready(a)).spec;
    await small.ready(b);
    await small.ready(c);                                   // a is now the oldest of three, cap is two
    const rehydrated = await small.ready(a);
    expect(rehydrated.spec).not.toBe(specA);                // rebuilt from the stored spec xdr
    expect(rehydrated.model.functions).toHaveLength(16);
    expect((await small.ready(a)).spec).toBe(rehydrated.spec);   // and cached again
  });
});
