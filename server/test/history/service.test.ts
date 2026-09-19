import { describe, it, expect } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { HistoryService } from '../../src/history/service.js';
import { FakeHistorySource } from '../helpers/fakeHistory.js';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { parseWasm } from '../../src/spec/model.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const spec = parseWasm(loadFixtureWasm());   // declares Pinged { prefix_topics: ['pinged'], who: topic_list, n: data, data_format: map }
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const pingedRawAt = (ledger: number, id = '0001-1') => ({
  id, ledger, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true,
  topic: [xdr.ScVal.scvSymbol('pinged'), nativeToScVal(G, { type: 'address' })].map(b64),
  value: b64(nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }))
});
const pingedRaw = () => pingedRawAt(150_000);
const RETENTION = { oldestLedger: 1000, latestLedger: 200_000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' };
const ready = async () => ({ model: { id: FIXTURE_ID, network: 'testnet' as const, name: 'KitchenSink', wasmHash: 'h', specLedger: 0, functions: [], types: [], errors: [], events: [] }, spec });

describe('HistoryService', () => {
  it('decodes a page and post-filters events by address', async () => {
    const source = new FakeHistorySource();
    source.pages = [{ events: [pingedRaw()], cursor: 'c1', ...RETENTION }];
    const svc = new HistoryService(source, ready);
    const res = await svc.query(FIXTURE_ID, {});
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toMatchObject({ event: 'pinged', topics: ['pinged', G], data: { who: G, n: 7 } });
    // cursor is null even though the source returned 'c1': a 1-event page is short of the 50-event
    // limit, so it must be the end of the range regardless of what the RPC's own cursor says (I2).
    expect(res.page).toMatchObject({ cursor: null, limit: 50, from_ledger: 200_000 - 17_280, to_ledger: 200_000 });
    expect(res.retention).toMatchObject({ oldest_ledger: 1000, latest_ledger: 200_000, note: 'RPC history covers the last ~7 days' });

    const source2 = new FakeHistorySource();
    source2.pages = [{ events: [pingedRaw()], cursor: null, ...RETENTION }];
    const svc2 = new HistoryService(source2, ready);
    const filtered = await svc2.query(FIXTURE_ID, { address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' });
    expect(filtered.events).toHaveLength(0);
  });

  it('caches identical queries within the TTL; a different limit misses', async () => {
    const source = new FakeHistorySource();
    const empty = { events: [], cursor: null, ...RETENTION };
    source.pages = [empty, empty];
    const svc = new HistoryService(source, ready, { ttlMs: 10_000 });
    await svc.query(FIXTURE_ID, { limit: 10 });
    await svc.query(FIXTURE_ID, { limit: 10 });
    expect(source.calls).toHaveLength(1);
    await svc.query(FIXTURE_ID, { limit: 20 });
    expect(source.calls).toHaveLength(2);
  });

  it('evicts the oldest cache entry once entries exceed max', async () => {
    const source = new FakeHistorySource();
    const empty = { events: [], cursor: null, ...RETENTION };
    source.pages = [empty, empty, empty, empty];
    const svc = new HistoryService(source, ready, { ttlMs: 10_000, max: 2 });
    await svc.query(FIXTURE_ID, { limit: 10 });
    await svc.query(FIXTURE_ID, { limit: 20 });
    await svc.query(FIXTURE_ID, { limit: 30 });
    expect(source.calls).toHaveLength(3);
    await svc.query(FIXTURE_ID, { limit: 10 });   // first key was evicted past max:2 -> source hit again
    expect(source.calls).toHaveLength(4);
    await svc.query(FIXTURE_ID, { limit: 30 });   // still the most-recently-used entry -> no new call
    expect(source.calls).toHaveLength(4);
  });

  it('clamps the requested range to retention and reports the clamp in page.from_ledger/to_ledger', async () => {
    const source = new FakeHistorySource();
    source.pages = [{ events: [], cursor: null, ...RETENTION }];
    const svc = new HistoryService(source, ready);
    const res = await svc.query(FIXTURE_ID, { from: '10', to: '50000' });
    expect(res.page.from_ledger).toBe(1000);   // clamped up to oldestLedger
    expect(res.page.to_ledger).toBe(50_000);
  });

  describe('bounded pages (review finding I2)', () => {
    it('drops raw events past the requested to and nulls the cursor once any were dropped', async () => {
      const source = new FakeHistorySource();
      // limit: 1 and the kept event's ledger (149_999) both stay clear of the other two null triggers,
      // isolating "an event was dropped" as the reason the cursor comes back null.
      source.pages = [{ events: [pingedRawAt(149_999), pingedRawAt(150_100, '0002-1')], cursor: 'c1', ...RETENTION }];
      const svc = new HistoryService(source, ready);
      const res = await svc.query(FIXTURE_ID, { to: '150000', limit: '1' });
      expect(res.events).toHaveLength(1);
      expect(res.events[0].ledger).toBe(149_999);
      expect(res.page.cursor).toBeNull();
    });

    it('nulls the cursor when the last kept event reaches to, even though nothing was dropped', async () => {
      const source = new FakeHistorySource();
      // limit: 1 matches the single returned event, so the "fewer than limit" trigger does not fire —
      // only "last kept ledger >= to" can be responsible for the null cursor.
      source.pages = [{ events: [pingedRawAt(150_000)], cursor: 'c1', ...RETENTION }];
      const svc = new HistoryService(source, ready);
      const res = await svc.query(FIXTURE_ID, { to: '150000', limit: '1' });
      expect(res.events).toHaveLength(1);
      expect(res.page.cursor).toBeNull();
    });

    it('nulls the cursor when the page returns fewer events than the requested limit', async () => {
      const source = new FakeHistorySource();
      // to is well past the single event's ledger, so neither the "dropped" nor the "reached to"
      // trigger fires — only "page.events.length < limit" can be responsible for the null cursor.
      source.pages = [{ events: [pingedRawAt(150_000)], cursor: 'c1', ...RETENTION }];
      const svc = new HistoryService(source, ready);
      const res = await svc.query(FIXTURE_ID, { to: '200000', limit: '5' });
      expect(res.events).toHaveLength(1);
      expect(res.page.cursor).toBeNull();
    });

    it('keeps a real cursor when the page is full, unbounded by to, and nothing was dropped', async () => {
      const source = new FakeHistorySource();
      source.pages = [{ events: [pingedRawAt(150_000)], cursor: 'c1', ...RETENTION }];
      const svc = new HistoryService(source, ready);
      const res = await svc.query(FIXTURE_ID, { to: '200000', limit: '1' });
      expect(res.page.cursor).toBe('c1');
    });
  });

  it('two concurrent identical queries share one source.events() call (single-flight, review finding M5-lite)', async () => {
    const source = new FakeHistorySource();
    source.pages = [{ events: [pingedRaw()], cursor: null, ...RETENTION }];
    const svc = new HistoryService(source, ready);
    const [a, b] = await Promise.all([svc.query(FIXTURE_ID, {}), svc.query(FIXTURE_ID, {})]);
    expect(source.calls).toHaveLength(1);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });
});
