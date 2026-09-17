import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PgStore, MemoryStore, type Store } from '../../src/registry/store.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://sonata:sonata@localhost:5432/sonata_test';
const ID = FIXTURE_ID;

function suite(name: string, make: () => Promise<{ store: Store; reset: () => Promise<void>; close: () => Promise<void> }>) {
  describe(name, () => {
    let s: Store, reset: () => Promise<void>, close: () => Promise<void>;
    beforeAll(async () => ({ store: s, reset, close } = await make()));
    beforeEach(() => reset());
    afterAll(() => close());

    it('upsertQueued creates then keeps an existing row', async () => {
      const a = await s.upsertQueued(ID, 'testnet', 'Kitchen');
      expect(a).toMatchObject({ id: ID, network: 'testnet', name: 'Kitchen', status: 'queued', mcpScope: 'ro', steps: [] });
      const b = await s.upsertQueued(ID, 'testnet', null);
      expect(b.name).toBe('Kitchen');
      expect((await s.list()).map((r) => r.id)).toEqual([ID]);
    });
    it('update patches and bumps updatedAt', async () => {
      const a = await s.upsertQueued(ID, 'testnet', null);
      const b = await s.update(ID, { status: 'ready', steps: [{ name: 'fetch', status: 'done', detail: 'x' }], mcpScope: 'rw' });
      expect(b.status).toBe('ready'); expect(b.steps[0].detail).toBe('x'); expect(b.mcpScope).toBe('rw');
      expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
      expect(await s.get('CNOPE')).toBeNull();
    });
    it('hints round-trip and overwrite', async () => {
      await s.upsertQueued(ID, 'testnet', null);
      await s.setHint(ID, 'bump', 'write'); await s.setHint(ID, 'bump', 'read');
      expect(await s.getHints(ID)).toEqual({ bump: 'read' });
    });
  });
}

suite('MemoryStore', async () => { const store = new MemoryStore(); return { store, reset: async () => store.clear(), close: async () => {} }; });
suite('PgStore', async () => {
  const pool = new pg.Pool({ connectionString: URL });
  return { store: new PgStore(pool), reset: async () => { await pool.query('truncate contracts cascade'); }, close: () => pool.end() };
});
