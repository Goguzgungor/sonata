import { describe, it, expect, vi } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { loadConfig } from '../../src/config.js';
import { RpcHistorySource } from '../../src/history/rpc.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const cfg = loadConfig({ DATABASE_URL: 'postgres://unused' });
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const ev = (id: string, ledger: number) => ({ id, type: 'contract', ledger, ledgerClosedAt: '2026-09-18T16:13:58Z', transactionIndex: 1, operationIndex: 0, inSuccessfulContractCall: true, txHash: 'ab'.repeat(32), contractId: { contractId: () => FIXTURE_ID }, topic: [sym('pinged'), nativeToScVal('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', { type: 'address' })], value: nativeToScVal(7, { type: 'u32' }) });
const page = { events: [ev('0001-1', 100), ev('0002-1', 101)], latestLedger: 200, latestLedgerCloseTime: '1789751923', oldestLedger: 10, oldestLedgerCloseTime: '1789700000', cursor: '0002-1' };
const source = (server: Record<string, unknown>) => new RpcHistorySource(cfg, () => server as never);

describe('RpcHistorySource', () => {
  it('maps getEvents to RawEvent pages (base64 XDR, cursor, retention)', async () => {
    const getEvents = vi.fn().mockResolvedValue(page);
    const s = source({ getEvents, getLatestLedger: vi.fn() });
    const r = await s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 50, endLedger: 150, topics: [['AAAADwAAAAZwaW5nZWQ=', '*']], limit: 2 });
    expect(getEvents).toHaveBeenCalledWith({ startLedger: 50, endLedger: 150, filters: [{ type: 'contract', contractIds: [FIXTURE_ID], topics: [['AAAADwAAAAZwaW5nZWQ=', '*']] }], limit: 2 });
    expect(r.events).toHaveLength(2);
    expect(r.events[0]).toMatchObject({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true });
    expect(r.events[0].topic[0]).toBe(sym('pinged').toXDR('base64')); expect(r.events[0].value).toBe(nativeToScVal(7, { type: 'u32' }).toXDR('base64'));
    expect(r).toMatchObject({ cursor: '0002-1', oldestLedger: 10, latestLedger: 200, latestLedgerCloseTime: new Date(1789751923 * 1000).toISOString() });
  });
  it('passes cursor instead of startLedger when paging, and null cursor on an empty tail', async () => {
    const getEvents = vi.fn().mockResolvedValue({ ...page, events: [], cursor: '' });
    const s = source({ getEvents });
    const r = await s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 50, cursor: '0002-1', limit: 5 });
    expect(getEvents.mock.calls[0][0]).toMatchObject({ cursor: '0002-1', limit: 5 }); expect(getEvents.mock.calls[0][0].startLedger).toBeUndefined();
    expect(r.cursor).toBeNull();
  });
  it('maps an out-of-window startLedger to 400 range_out_of_retention and other failures to 502', async () => {
    const s = source({ getEvents: vi.fn().mockRejectedValue(new Error('startLedger must be within the ledger range: 10 - 200')) });
    await expect(s.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 1, limit: 1 })).rejects.toMatchObject({ status: 400, error: 'range_out_of_retention', extra: { details: { oldest_ledger: 10, latest_ledger: 200 } } });
    const t = source({ getEvents: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) });
    await expect(t.events({ contractId: FIXTURE_ID, network: 'testnet', startLedger: 1, limit: 1 })).rejects.toMatchObject({ status: 502, error: 'rpc_unavailable' });
  });
  it('retention() uses getLatestLedger + a 1-event probe and caches for 60 s', async () => {
    const getLatestLedger = vi.fn().mockResolvedValue({ sequence: 200 });
    const getEvents = vi.fn().mockResolvedValue({ ...page, events: [] });
    const s = source({ getLatestLedger, getEvents });
    expect(await s.retention('testnet')).toEqual({ oldestLedger: 10, latestLedger: 200, latestLedgerCloseTime: new Date(1789751923 * 1000).toISOString() });
    await s.retention('testnet');
    expect(getEvents).toHaveBeenCalledTimes(1);
  });
});
