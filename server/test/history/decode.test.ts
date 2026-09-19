import { describe, it, expect } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeEvent, matchesAddress, resolveSymbol, topicFiltersFor, type DecodedEvent } from '../../src/history/decode.js';
import { toCsv } from '../../src/history/csv.js';
import { topicFilters } from '../../src/history/query.js';
import { loadFixtureWasm } from '../fixtures/index.js';
import { parseWasm } from '../../src/spec/model.js';
import { sacSpec } from '../../src/spec/sacSpec.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const spec = parseWasm(loadFixtureWasm());   // declares Pinged { prefix_topics: ['pinged'], who: topic_list, n: data, data_format: map }
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const raw = (topic: xdr.ScVal[], value: xdr.ScVal) => ({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true, topic: topic.map(b64), value: b64(value) });
const pinged = () => raw([xdr.ScVal.scvSymbol('pinged'), nativeToScVal(G, { type: 'address' })], nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }));

describe('resolveSymbol', () => {
  it('resolves a declared event by name or prefix topic (any case) to its on-chain symbol', () => {
    expect(resolveSymbol(spec, 'Pinged')).toBe('pinged');
    expect(resolveSymbol(spec, 'pinged')).toBe('pinged');
    expect(resolveSymbol(spec, 'PINGED')).toBe('pinged');
  });
  it('passes an undeclared symbol through unchanged', () => {
    expect(resolveSymbol(spec, 'transfer')).toBe('transfer');
  });
});

describe('topicFiltersFor', () => {
  it('resolves a declared event by name or prefix topic (any case) to the resolved symbol\'s four arity-covering rows, not an exact-arity row', () => {
    // C1 regression: an exact-arity row built from the declared topic list alone can be shorter than
    // what the contract actually emits (see the SAC regression test below), so a declared event must
    // still get all four wildcard rows for its resolved symbol — same shape as an undeclared symbol.
    expect(topicFiltersFor(spec, 'Pinged')).toEqual(topicFilters('pinged'));
    expect(topicFiltersFor(spec, 'pinged')).toEqual(topicFilters('pinged'));
    expect(topicFiltersFor(spec, 'PINGED')).toEqual(topicFilters('pinged'));
  });
  it('falls back to the four wildcard rows for an undeclared symbol', () => {
    expect(topicFiltersFor(spec, 'transfer')).toEqual(topicFilters('transfer'));
  });
  it('a SAC Transfer filter includes the 4-segment row that on-chain SAC transfer/approve events actually carry', () => {
    // The vendored SAC spec declares Transfer as [transfer, from, to] (3 topics), but on-chain SAC
    // transfer/approve events carry a trailing sep0011_asset topic (4 topics) — verified live on
    // testnet (final-review.md C1). The exact-arity row `[sym, '*', '*']` alone would miss every one.
    const sac = sacSpec();
    const sym = xdr.ScVal.scvSymbol('transfer').toXDR('base64');
    const rows = topicFiltersFor(sac, 'Transfer');
    expect(rows).toContainEqual([sym, '*', '*', '*']);
    expect(rows).toEqual(topicFilters('transfer'));
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
  it('toCsv quotes a cell containing a bare CR', () => {
    // A raw \r inside a plain string field (unlike inside JSON.stringify'd topics/data, which
    // escapes it to the two characters `\r`) is the case that specifically exercises the CR
    // branch of the quoting regex, independent of the pre-existing quote-character trigger.
    const ev: DecodedEvent = { id: 'a\rb', ledger: 1, closed_at: '2026-01-01T00:00:00Z', tx_hash: 'ab'.repeat(32), successful: true, event: null, topics: [], data: null, raw: { topic: [], value: '' }, explorer_url: '' };
    const csv = toCsv([ev]);
    expect(csv.split('\n')[1]).toContain('"a\rb"');
  });
});
