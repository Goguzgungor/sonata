import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PgStore, MemoryStore, type Store } from '../../src/registry/store.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://sonata:sonata@localhost:5432/sonata_test';
const ID = FIXTURE_ID;
const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function suite(name: string, make: () => Promise<{ store: Store; reset: () => Promise<void>; close: () => Promise<void> }>) {
  describe(name, () => {
    let s: Store, reset: () => Promise<void>, close: () => Promise<void>;
    beforeAll(async () => ({ store: s, reset, close } = await make()));
    beforeEach(() => reset());
    afterAll(() => close());

    it('upsertQueued creates then keeps an existing row', async () => {
      const a = await s.upsertQueued(ID, 'testnet', 'Kitchen', null);
      expect(a).toMatchObject({ id: ID, network: 'testnet', name: 'Kitchen', status: 'queued', mcpScope: 'ro', steps: [] });
      const b = await s.upsertQueued(ID, 'testnet', null, null);
      expect(b.name).toBe('Kitchen');
      expect((await s.list()).map((r) => r.id)).toEqual([ID]);
    });
    it('update patches and bumps updatedAt', async () => {
      const a = await s.upsertQueued(ID, 'testnet', null, null);
      const b = await s.update(ID, { status: 'ready', steps: [{ name: 'fetch', status: 'done', detail: 'x' }], mcpScope: 'rw' });
      expect(b.status).toBe('ready'); expect(b.steps[0].detail).toBe('x'); expect(b.mcpScope).toBe('rw');
      expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
      expect(await s.get('CNOPE')).toBeNull();
    });
    it('ping resolves against a live store', async () => {
      await expect(s.ping()).resolves.toBeUndefined();
    });
    it('hints round-trip and overwrite', async () => {
      await s.upsertQueued(ID, 'testnet', null, null);
      await s.setHint(ID, 'bump', 'write'); await s.setHint(ID, 'bump', 'read');
      expect(await s.getHints(ID)).toEqual({ bump: 'read' });
    });
    it('upsertQueued stores the owner and never overwrites an existing one', async () => {
      expect((await s.upsertQueued(ID, 'testnet', 'KS', A)).owner).toBe(A);
      expect((await s.upsertQueued(ID, 'testnet', null, B)).owner).toBe(A);   // route layer rejects B before this; the store is defensive too
    });
    it('a legacy row (owner null) takes the first owner offered', async () => {
      await s.upsertQueued(ID, 'testnet', null, null);
      expect((await s.get(ID))!.owner).toBeNull();
      expect((await s.upsertQueued(ID, 'testnet', null, B)).owner).toBe(B);
    });
    it('claimOwner sets a NULL owner atomically; a second claim loses, and the first owner stands', async () => {
      await s.upsertQueued(ID, 'testnet', null, null);
      const claimed = await s.claimOwner(ID, A);
      expect(claimed!.owner).toBe(A);
      const lost = await s.claimOwner(ID, B);
      expect(lost).toBeNull();
      expect((await s.get(ID))!.owner).toBe(A);
    });
    it('claimOwner returns null for an unknown id', async () => {
      expect(await s.claimOwner('CNOPE', A)).toBeNull();
    });
    it('list filters by owner', async () => {
      await s.upsertQueued(ID, 'testnet', null, A);
      await s.upsertQueued(OTHER, 'mainnet', null, B);
      expect((await s.list()).map((r) => r.id).sort()).toEqual([ID, OTHER].sort());
      expect((await s.list({ owner: A })).map((r) => r.id)).toEqual([ID]);
      expect(await s.list({ owner: 'GNOBODY' })).toEqual([]);
    });
    it('settings round-trip', async () => {
      expect(await s.getSetting('auth_secret')).toBeNull();
      await s.setSetting('auth_secret', 'abc');
      expect(await s.getSetting('auth_secret')).toBe('abc');
      await s.setSetting('auth_secret', 'def');
      expect(await s.getSetting('auth_secret')).toBe('def');
    });
    it('putSettingIfAbsent inserts only when absent; first writer wins on a race', async () => {
      expect(await s.putSettingIfAbsent('auth_secret', 'first')).toBe('first');
      expect(await s.putSettingIfAbsent('auth_secret', 'second')).toBe('first');
      expect(await s.getSetting('auth_secret')).toBe('first');
    });
  });
}

suite('MemoryStore', async () => { const store = new MemoryStore(); return { store, reset: async () => store.clear(), close: async () => {} }; });
suite('PgStore', async () => {
  const pool = new pg.Pool({ connectionString: URL });
  return { store: new PgStore(pool), reset: async () => { await pool.query('truncate contracts, settings cascade'); }, close: () => pool.end() };
});
