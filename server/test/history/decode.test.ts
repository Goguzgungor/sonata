import { describe, it, expect } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeEvent, matchesAddress, topicFiltersFor } from '../../src/history/decode.js';
import { toCsv } from '../../src/history/csv.js';
import { topicFilters } from '../../src/history/query.js';
import { loadFixtureWasm } from '../fixtures/index.js';
import { parseWasm } from '../../src/spec/model.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const spec = parseWasm(loadFixtureWasm());   // declares Pinged { prefix_topics: ['pinged'], who: topic_list, n: data, data_format: map }
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const raw = (topic: xdr.ScVal[], value: xdr.ScVal) => ({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true, topic: topic.map(b64), value: b64(value) });
const pinged = () => raw([xdr.ScVal.scvSymbol('pinged'), nativeToScVal(G, { type: 'address' })], nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }));

describe('topicFiltersFor', () => {
  it('resolves a declared event by name or prefix topic (any case) to its exact-arity filter row', () => {
    const sym = xdr.ScVal.scvSymbol('pinged').toXDR('base64');
    expect(topicFiltersFor(spec, 'Pinged')).toEqual([[sym, '*']]);
    expect(topicFiltersFor(spec, 'pinged')).toEqual([[sym, '*']]);
    expect(topicFiltersFor(spec, 'PINGED')).toEqual([[sym, '*']]);
  });
  it('falls back to the four wildcard rows for an undeclared symbol', () => {
    expect(topicFiltersFor(spec, 'transfer')).toEqual(topicFilters('transfer'));
  });
});

describe('decodeEvent', () => {
  it('decodes topics and data of a declared event via the SDK SEP-48 parser', () => {
    const ev = decodeEvent(pinged(), spec, 'testnet');
    expect(ev).toMatchObject({ event: 'pinged', topics: ['pinged', G], data: { who: G, n: 7 }, successful: true, ledger: 100, tx_hash: 'ab'.repeat(32), explorer_url: `https://stellar.expert/explorer/testnet/tx/${'ab'.repeat(32)}` });
    expect(ev.raw.topic).toHaveLength(2);
  });
  it('undeclared events decode generically; undecodable data gives null', () => {
    const undeclared = decodeEvent(raw([xdr.ScVal.scvSymbol('burn')], nativeToScVal([1n, 2n], { type: ['i128', 'i128'] })), spec, 'mainnet');
    expect(undeclared).toMatchObject({ event: 'burn', data: ['1', '2'], explorer_url: expect.stringContaining('/public/tx/') });
    const bad = decodeEvent({ ...pinged(), value: 'not-xdr' }, spec, 'testnet');
    expect(bad.data).toBeNull(); expect(bad.event).toBe('pinged');
  });
  it('matchesAddress looks through topics and nested data', () => {
    const ev = decodeEvent(pinged(), spec, 'testnet');
    expect(matchesAddress(ev, G)).toBe(true); expect(matchesAddress(ev, 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H')).toBe(false);
  });
  it('toCsv escapes and JSON-encodes topics/data', () => {
    const csv = toCsv([decodeEvent(pinged(), spec, 'testnet')]);
    expect(csv.split('\n')[0]).toBe('id,ledger,closed_at,tx_hash,successful,event,topics,data');
    expect(csv.split('\n')[1]).toContain('"[""pinged"",""' + G + '""]"');
  });
});
