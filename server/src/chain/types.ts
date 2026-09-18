import type { xdr } from '@stellar/stellar-sdk';
import type { Network } from '../types.js';

export type SimResult = { retval: xdr.ScVal; auth: string[]; ledger: number; minResourceFee: string; readWriteCount: number; latencyMs: number };
export type BuiltTx = { xdr: string; fee: string; auth: string[]; ledger: number; expiresAt: string };
/**
 * `returnValue` is the invocation's ScVal (base64) — present only on SUCCESS, and only when the
 * function returns something. `resultXdr` is the whole TransactionResult (base64), present on both
 * SUCCESS and FAILED; the two were conflated under one field before (review finding I6).
 */
export type TxStatus = { hash: string; status: 'success' | 'failed' | 'pending'; ledger?: number; feeCharged?: string; returnValue?: string; resultXdr?: string };
export interface Chain {
  getContractWasm(network: Network, id: string): Promise<Buffer>;
  simulate(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult>;
  buildTx(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx>;
  submit(network: Network, xdrB64: string, waitMs: number): Promise<TxStatus>;
  getTx(network: Network, hash: string): Promise<TxStatus>;
  health(network: Network): Promise<'ok' | 'error'>;
}
