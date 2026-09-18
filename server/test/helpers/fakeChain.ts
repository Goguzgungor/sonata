import { xdr } from '@stellar/stellar-sdk';
import type { Chain, SimResult, BuiltTx, TxStatus } from '../../src/chain/types.js';
import type { Network } from '../../src/types.js';
import { loadFixtureWasm } from '../fixtures/index.js';

/** A successful submit/getTx result: both XDR fields are distinct so routes cannot conflate them (review finding I6). */
const DONE = { hash: 'h', status: 'success' as const, ledger: 101, returnValue: 'AAAAAwAAAAo=', resultXdr: 'AAAAAAAAAGQAAAAAAAAAAQ==' };

/** Scripted Chain: every method can be overridden per test via `impl`. Defaults return the fixture wasm and void results. */
export class FakeChain implements Chain {
  calls: Array<{ method: string; args: unknown[] }> = [];
  impl: Partial<Chain> = {};
  private rec<T>(method: string, args: unknown[], dflt: () => T | Promise<T>): Promise<T> {
    this.calls.push({ method, args });
    const f = (this.impl as any)[method];
    return Promise.resolve(f ? f(...args) : dflt());
  }
  getContractWasm(n: Network, id: string) { return this.rec('getContractWasm', [n, id], () => loadFixtureWasm()); }
  simulate(n: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult> {
    return this.rec('simulate', [n, id, fn, args, source], () => ({ retval: xdr.ScVal.scvVoid(), auth: [], ledger: 100, minResourceFee: '100', readWriteCount: 0, latencyMs: 1 }));
  }
  buildTx(n: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx> {
    return this.rec('buildTx', [n, id, fn, args, source, opts], () => ({ xdr: 'AAAA', fee: '100', auth: [source], ledger: 100, expiresAt: '2026-01-01T00:00:00.000Z' }));
  }
  submit(n: Network, x: string, waitMs: number): Promise<TxStatus> { return this.rec('submit', [n, x, waitMs], () => ({ ...DONE, hash: 'h' })); }
  getTx(n: Network, hash: string): Promise<TxStatus> { return this.rec('getTx', [n, hash], () => ({ ...DONE, hash })); }
  health(n: Network) { return this.rec('health', [n], () => 'ok' as const); }
}
