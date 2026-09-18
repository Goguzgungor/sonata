import { describe, it, expect, vi, afterEach } from 'vitest';
import { Account, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { loadConfig, PASSPHRASES } from '../../src/config.js';
import { RpcChain } from '../../src/chain/rpc.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const cfg = loadConfig({ DATABASE_URL: 'postgres://unused' });
const SIGNED = new TransactionBuilder(new Account(G, '0'), { fee: '100', networkPassphrase: PASSPHRASES.testnet })
  .addOperation(Operation.bumpSequence({ bumpTo: '1' })).setTimeout(300).build().toXDR();

/** Minimal stand-ins for the SDK's XDR wrappers: toStatus only reads `.feeCharged` and `.toXdr('base64')`. */
const RESULT = { feeCharged: 4321, toXdr: () => 'RESULT_XDR' };
const RETVAL = { toXdr: () => 'RETURN_VALUE' };
const SUCCESS = { status: 'SUCCESS', ledger: 777, resultXdr: RESULT, returnValue: RETVAL };
const NOT_FOUND = { status: 'NOT_FOUND' };

const chainWith = (server: Record<string, unknown>) => new RpcChain(cfg, () => server as never);

afterEach(() => { vi.useRealTimers(); });

/** Drives submit() past its 1 s polling sleeps without waiting for real time. */
async function submitWithPolls(server: Record<string, unknown>, waitMs = 30_000) {
  vi.useFakeTimers();
  const p = chainWith(server).submit('testnet', SIGNED, waitMs);
  const settled = p.then((v) => ({ ok: v }), (e) => ({ err: e }));
  await vi.advanceTimersByTimeAsync(waitMs);
  const r = await settled;
  if ('err' in r) throw r.err;
  return r.ok!;
}

describe('RpcChain.submit', () => {
  it('treats DUPLICATE as pending and reports the polled outcome', async () => {
    const getTransaction = vi.fn().mockResolvedValueOnce(NOT_FOUND).mockResolvedValue(SUCCESS);
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'DUPLICATE', hash: 'dup' });
    const status = await submitWithPolls({ sendTransaction, getTransaction });
    expect(status).toEqual({ hash: 'dup', status: 'success', ledger: 777, feeCharged: '4321', returnValue: 'RETURN_VALUE', resultXdr: 'RESULT_XDR' });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });
  it('treats TRY_AGAIN_LATER as pending too', async () => {
    const server = { sendTransaction: vi.fn().mockResolvedValue({ status: 'TRY_AGAIN_LATER', hash: 'later' }), getTransaction: vi.fn().mockResolvedValue(NOT_FOUND) };
    expect(await submitWithPolls(server, 2000)).toEqual({ hash: 'later', status: 'pending' });
  });
  it('polls a PENDING submit until the network has it', async () => {
    const getTransaction = vi.fn().mockResolvedValueOnce(NOT_FOUND).mockResolvedValue(SUCCESS);
    const status = await submitWithPolls({ sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'h1' }), getTransaction });
    expect(status).toMatchObject({ hash: 'h1', status: 'success' });
  });
  it('splits return_value from result_xdr on a FAILED transaction', async () => {
    const server = { sendTransaction: vi.fn().mockResolvedValue({ status: 'PENDING', hash: 'h2' }), getTransaction: vi.fn().mockResolvedValue({ status: 'FAILED', ledger: 9, resultXdr: RESULT }) };
    expect(await submitWithPolls(server)).toEqual({ hash: 'h2', status: 'failed', ledger: 9, resultXdr: 'RESULT_XDR' });
  });
  it('only ERROR is 422 submit_rejected, and sendTransaction is never retried', async () => {
    const sendTransaction = vi.fn().mockResolvedValue({ status: 'ERROR', hash: 'e', errorResult: { toXdr: () => 'ERR_XDR' } });
    await expect(chainWith({ sendTransaction }).submit('testnet', SIGNED, 1000))
      .rejects.toMatchObject({ status: 422, error: 'submit_rejected', extra: { details: { errorResult: 'ERR_XDR' } } });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('does not retry a transient sendTransaction failure', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(new Error('socket hang up'));
    await expect(chainWith({ sendTransaction }).submit('testnet', SIGNED, 1000)).rejects.toMatchObject({ status: 502, error: 'rpc_unavailable' });
    expect(sendTransaction).toHaveBeenCalledTimes(1);
  });
  it('rejects an xdr that is not an envelope for this network', async () => {
    await expect(chainWith({}).submit('testnet', 'not-xdr', 1000)).rejects.toMatchObject({ status: 400, error: 'invalid_xdr' });
  });
});

describe('RpcChain.getContractWasm', () => {
  // The SDK rejects with a plain object { code: 404, message } — not an Error — for a missing
  // contract instance or wasm entry; without the mapping below guard() turned it into a 502.
  it('maps the SDK 404 to a readable contract_not_found', async () => {
    const server = { getContractWasmByContractId: vi.fn().mockRejectedValue({ code: 404, message: 'Could not obtain contract instance from server' }) };
    await expect(chainWith(server).getContractWasm('testnet', FIXTURE_ID)).rejects.toMatchObject({
      status: 404, error: 'contract_not_found', message: `contract ${FIXTURE_ID} does not exist on testnet`
    });
  });
  it('maps the SDK\'s SAC rejection to 400 sac_unsupported', async () => {
    const server = { getContractWasmByContractId: vi.fn().mockRejectedValue(new Error(`Contract ${FIXTURE_ID} is a Stellar Asset Contract (SAC), which has no Wasm bytecode. Use contract.getSpec instead.`)) };
    await expect(chainWith(server).getContractWasm('testnet', FIXTURE_ID)).rejects.toMatchObject({ status: 400, error: 'sac_unsupported', message: expect.stringContaining('Stellar Asset Contract') });
  });
  it('still reports a real RPC failure as 502', async () => {
    const server = { getContractWasmByContractId: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) };
    await expect(chainWith(server).getContractWasm('testnet', FIXTURE_ID)).rejects.toMatchObject({ status: 502, error: 'rpc_unavailable' });
  });
  it('returns the wasm bytes when the contract is there', async () => {
    const server = { getContractWasmByContractId: vi.fn().mockResolvedValue(new Uint8Array([0, 97, 115, 109])) };
    expect(await chainWith(server).getContractWasm('testnet', FIXTURE_ID)).toEqual(Buffer.from([0, 97, 115, 109]));
  });
});
