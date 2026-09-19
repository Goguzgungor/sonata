import { describe, it, expect } from 'vitest';
import { xdr } from '@stellar/stellar-sdk';
import { normaliseQuery, topicFilters } from '../../src/history/query.js';

const ret = { oldestLedger: 1000, latestLedger: 200_000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' };
describe('normaliseQuery', () => {
  it('defaults: last ~24h, limit 50, json', () => {
    expect(normaliseQuery({}, ret)).toMatchObject({ fromLedger: 200_000 - 17_280, toLedger: 200_000, limit: 50, format: 'json' });
  });
  it('accepts ledgers or ISO times, clamps to retention', () => {
    expect(normaliseQuery({ from: '500', to: '150000' }, ret)).toMatchObject({ fromLedger: 1000, toLedger: 150_000 });
    const oneHourAgo = new Date(Date.parse(ret.latestLedgerCloseTime) - 3600_000).toISOString();
    expect(normaliseQuery({ from: oneHourAgo }, ret).fromLedger).toBe(200_000 - Math.round(3600 / 5.5));
    expect(normaliseQuery({ to: '9999999' }, ret).toLedger).toBe(200_000);
  });
  it('clamps both ends before comparing, so an out-of-range from does not falsely read as after to', () => {
    expect(normaliseQuery({ from: '9999999' }, ret)).toMatchObject({ fromLedger: 200_000, toLedger: 200_000 });
  });
  it('rejects bad input with invalid_args + path', () => {
    for (const [raw, path] of [[{ limit: '0' }, 'limit'], [{ limit: '201' }, 'limit'], [{ from: 'yesterday' }, 'from'], [{ address: 'nope' }, 'address'], [{ format: 'xml' }, 'format'], [{ from: '5000', to: '4000' }, 'to']] as const) {
      expect(() => normaliseQuery(raw as any, ret)).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args', extra: { details: { path } } }));
    }
  });
  it('range entirely before the window is range_out_of_retention', () => {
    expect(() => normaliseQuery({ from: '10', to: '20' }, ret)).toThrow(expect.objectContaining({ error: 'range_out_of_retention' }));
  });
  it('topicFilters builds four topic[0] filters for the resolved symbol', () => {
    const sym = xdr.ScVal.scvSymbol('transfer').toXDR('base64');
    expect(topicFilters('transfer')).toEqual([[sym], [sym, '*'], [sym, '*', '*'], [sym, '*', '*', '*']]);
    expect(normaliseQuery({ type: 'Transfer' }, ret).type).toBe('Transfer');
  });
  it('accepts a symbol starting with a digit', () => {
    expect(normaliseQuery({ type: '1inch_swap' }, ret).type).toBe('1inch_swap');
  });
  it('accepts from/to as numbers, not just strings (MCP JSON args may pass a ledger as a number — review finding M4)', () => {
    expect(normaliseQuery({ from: 150_000, to: 160_000 }, ret)).toMatchObject({ fromLedger: 150_000, toLedger: 160_000 });
  });
});
