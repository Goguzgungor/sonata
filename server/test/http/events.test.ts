import { describe, it, expect } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { testApp, OWNER } from '../helpers/app.js';
import { FIXTURE_ID, loadFixtureWasm } from '../fixtures/index.js';
import { rpcUnavailable } from '../../src/chain/errors.js';
import { topicFilters } from '../../src/history/query.js';

const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const pingedRaw = () => ({
  id: '0001-1', ledger: 150_000, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true,
  topic: [xdr.ScVal.scvSymbol('pinged'), nativeToScVal(OWNER, { type: 'address' })].map(b64),
  value: b64(nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }))
});
const RETENTION = { oldestLedger: 1000, latestLedger: 200_000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' };

describe('GET /c/:id/events', () => {
  it('200s with a decoded page shaped per the response contract', async () => {
    const { app, registerFixture, historySource } = await testApp();
    await registerFixture();
    historySource.pages = [{ events: [pingedRaw()], cursor: 'c1', ...RETENTION }];
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events[0]).toMatchObject({ event: 'pinged', topics: ['pinged', OWNER], data: { n: 7 } });
    // cursor is null even though the source returned 'c1': a 1-event page is short of the 50-event
    // limit, so it must be the end of the range regardless of what the RPC's own cursor says (I2).
    expect(body.page).toMatchObject({ cursor: null, limit: 50 });
    expect(body.retention).toMatchObject({ oldest_ledger: 1000, latest_ledger: 200_000, latest_ledger_close_time: RETENTION.latestLedgerCloseTime, note: 'RPC history covers the last ~7 days' });
  });

  it('?type=Pinged (declared name, any case) resolves to the on-chain symbol and sends the four arity-covering rows', async () => {
    const { app, registerFixture, historySource } = await testApp();
    await registerFixture();
    historySource.pages = [{ events: [], cursor: null, ...RETENTION }];
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events?type=PINGED` });
    expect(res.statusCode).toBe(200);
    expect(historySource.calls).toHaveLength(1);
    expect(historySource.calls[0].topics).toEqual(topicFilters('pinged'));
  });

  it('?format=csv responds text/csv with the header row and an attachment filename', async () => {
    const { app, registerFixture, historySource } = await testApp();
    await registerFixture();
    historySource.pages = [{ events: [pingedRaw()], cursor: null, ...RETENTION }];
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events?format=csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${FIXTURE_ID}-events.csv"`);
    expect(res.body.split('\n')[0]).toBe('id,ledger,closed_at,tx_hash,successful,event,topics,data');
  });

  it('?limit=0 is 400 invalid_args at path limit', async () => {
    const { app, registerFixture } = await testApp();
    await registerFixture();
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events?limit=0` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_args', details: { path: 'limit' } });
  });

  it('?format=csv&limit=0 still errors as JSON, with no CSV content-disposition leaked onto the error response', async () => {
    const { app, registerFixture } = await testApp();
    await registerFixture();
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events?format=csv&limit=0` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_args' });
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('unknown contract is 404', async () => {
    const { app } = await testApp();
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events` });
    expect(res.statusCode).toBe(404);
  });

  it('a queued (not-yet-ready) contract is 409', async () => {
    const { app, chain, registry } = await testApp();
    chain.impl.getContractWasm = () => new Promise((resolve) => setTimeout(() => resolve(loadFixtureWasm()), 300));
    await registry.register(FIXTURE_ID, 'testnet', 'KitchenSink');
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events` });
    expect(res.statusCode).toBe(409);
    await registry.whenIdle();
  });

  it('?from=10&to=20 (entirely before retention) is 400 range_out_of_retention', async () => {
    const { app, registerFixture } = await testApp();
    await registerFixture();
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events?from=10&to=20` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('range_out_of_retention');
  });

  it('the source failing with rpcUnavailable surfaces as 502', async () => {
    const { app, registerFixture, historySource } = await testApp();
    await registerFixture();
    historySource.fail = rpcUnavailable('testnet', new Error('down'));
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events` });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('rpc_unavailable');
  });
});
