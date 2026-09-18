import { describe, it, expect } from 'vitest';
import { contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { decodeEvent, matchesAddress, resolveTopic } from '../../src/history/decode.js';
import { toCsv } from '../../src/history/csv.js';
import { loadFixtureWasm } from '../fixtures/index.js';
import { parseWasm } from '../../src/spec/model.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const spec = parseWasm(loadFixtureWasm());   // declares Pinged { prefix_topics: ['pinged'], who: topic_list, n: data, data_format: map }
const fakeSpec = (value: Record<string, unknown>) => ({ entries: [{ type: 'scSpecEntryEventV0', value }] }) as unknown as contract.Spec;
const b64 = (v: xdr.ScVal) => v.toXDR('base64');
const raw = (topic: xdr.ScVal[], value: xdr.ScVal) => ({ id: '0001-1', ledger: 100, closedAt: '2026-09-18T16:13:58Z', txHash: 'ab'.repeat(32), inSuccessfulContractCall: true, topic: topic.map(b64), value: b64(value) });
const pinged = () => raw([xdr.ScVal.scvSymbol('pinged'), nativeToScVal(G, { type: 'address' })], nativeToScVal({ n: 7 }, { type: { n: ['symbol', 'u32'] } }));

describe('resolveTopic', () => {
  it('maps a declared name or prefix topic to the on-chain symbol, else passes through', () => {
    expect(resolveTopic(spec, 'Pinged')).toBe('pinged'); expect(resolveTopic(spec, 'pinged')).toBe('pinged'); expect(resolveTopic(spec, 'PINGED')).toBe('pinged');
    expect(resolveTopic(spec, 'transfer')).toBe('transfer');
  });
});

describe('decodeEvent', () => {
  it('decodes topics and map-format data of a declared event', () => {
    const ev = decodeEvent(pinged(), spec, 'testnet');
    expect(ev).toMatchObject({ event: 'pinged', topics: ['pinged', G], data: { n: 7 }, successful: true, ledger: 100, tx_hash: 'ab'.repeat(32), explorer_url: `https://stellar.expert/explorer/testnet/tx/${'ab'.repeat(32)}` });
    expect(ev.raw.topic).toHaveLength(2);
  });
  it('names vec-format and single-value data from the spec params', () => {
    const vec = fakeSpec({ name: 'Swap', prefix_topics: ['swap'], params: [{ name: 'amount_in', location: 'data', type: 'i128' }, { name: 'amount_out', location: 'data', type: 'i128' }], data_format: 'vec' });
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('swap')], nativeToScVal([1n, 2n], { type: ['i128', 'i128'] })), vec, 'mainnet')).toMatchObject({ event: 'swap', data: { amount_in: '1', amount_out: '2' }, explorer_url: expect.stringContaining('/public/tx/') });
    const single = fakeSpec({ name: 'Minted', prefix_topics: ['minted'], params: [{ name: 'to', location: 'topic_list', type: 'address' }, { name: 'amount', location: 'data', type: 'i128' }], data_format: 'single_value' });
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('minted'), nativeToScVal(G, { type: 'address' })], nativeToScVal(5n, { type: 'i128' })), single, 'testnet').data).toEqual({ amount: '5' });
  });
  it('undeclared events decode generically; undecodable data gives null', () => {
    expect(decodeEvent(raw([xdr.ScVal.scvSymbol('burn')], nativeToScVal([1n, 2n], { type: ['i128', 'i128'] })), spec, 'testnet')).toMatchObject({ event: 'burn', data: ['1', '2'] });
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
