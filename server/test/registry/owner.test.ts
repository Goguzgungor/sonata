import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../src/registry/store.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('owner column', () => {
  it('upsertQueued stores the owner and never overwrites an existing one', async () => {
    const s = new MemoryStore();
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', 'KS', A)).owner).toBe(A);
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', null, B)).owner).toBe(A);   // route layer rejects B before this; the store is defensive too
  });
  it('a legacy row (owner null) takes the first owner offered', async () => {
    const s = new MemoryStore();
    await s.upsertQueued(FIXTURE_ID, 'testnet', null, null);
    expect((await s.get(FIXTURE_ID))!.owner).toBeNull();
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', null, B)).owner).toBe(B);
  });
  it('list filters by owner', async () => {
    const s = new MemoryStore();
    await s.upsertQueued(FIXTURE_ID, 'testnet', null, A);
    await s.upsertQueued(OTHER, 'mainnet', null, B);
    expect((await s.list()).map((r) => r.id).sort()).toEqual([FIXTURE_ID, OTHER].sort());
    expect((await s.list({ owner: A })).map((r) => r.id)).toEqual([FIXTURE_ID]);
    expect(await s.list({ owner: 'GNOBODY' })).toEqual([]);
  });
  it('settings round-trip', async () => {
    const s = new MemoryStore();
    expect(await s.getSetting('auth_secret')).toBeNull();
    await s.setSetting('auth_secret', 'abc');
    expect(await s.getSetting('auth_secret')).toBe('abc');
    await s.setSetting('auth_secret', 'def');
    expect(await s.getSetting('auth_secret')).toBe('def');
  });
});
