import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import type { Config } from '../config.js';
import type { Network } from '../types.js';
import type { BuiltTx, Chain, SimResult, TxStatus } from './types.js';
import { ChainError, networkNotConfigured, parseSimulationError, rpcUnavailable, sourceNotFound } from './errors.js';
import { authAddresses } from './auth.js';

const RPC_TIMEOUT_MS = 10_000;

export class RpcChain implements Chain {
  private servers = new Map<Network, rpc.Server>();
  constructor(private cfg: Config) {}

  private net(network: Network) {
    const n = this.cfg.networks[network];
    if (!n) throw networkNotConfigured(network);
    let s = this.servers.get(network);
    if (!s) { s = new rpc.Server(n.rpcUrl, { allowHttp: n.rpcUrl.startsWith('http://'), timeout: RPC_TIMEOUT_MS }); this.servers.set(network, s); }
    return { server: s, passphrase: n.passphrase };
  }

  private async guard<T>(network: Network, f: () => Promise<T>, retry = true): Promise<T> {
    try { return await f(); }
    catch (e) {
      if (e instanceof ChainError) throw e;
      const msg = String((e as Error)?.message ?? e);
      if (retry && /ECONN|ETIMEDOUT|timeout|5\d\d|socket hang up/i.test(msg)) return this.guard(network, f, false);
      throw rpcUnavailable(network, e);
    }
  }

  async getContractWasm(network: Network, id: string): Promise<Buffer> {
    const { server } = this.net(network);
    const wasm = await this.guard(network, () => server.getContractWasmByContractId(id));
    return Buffer.from(wasm);
  }

  private async simulateRaw(network: Network, id: string, fn: string, args: xdr.ScVal[], account: Account, timeoutS: number) {
    const { server, passphrase } = this.net(network);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(new Contract(id).call(fn, ...args)).setTimeout(timeoutS).build();
    const t0 = Date.now();
    const sim = await this.guard(network, () => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      const parsed = parseSimulationError(sim.error);
      if (parsed.kind === 'contract') throw new ChainError(422, 'contract_error', `contract returned error #${parsed.code}`, { code: parsed.code, details: { fn } });
      throw new ChainError(422, 'host_error', parsed.message.split('\n')[0], { details: { fn, diagnostics: sim.error } });
    }
    if (rpc.Api.isSimulationRestore(sim)) throw new ChainError(422, 'host_error', 'ledger entries need restoration before this call can run', { details: { fn } });
    const auth = authAddresses(sim.result?.auth ?? [], account.accountId());
    const data = sim.transactionData.build();
    return { tx, sim, latencyMs: Date.now() - t0, auth, readWriteCount: data.resources.footprint.readWrite.length };
  }

  async simulate(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult> {
    const r = await this.simulateRaw(network, id, fn, args, new Account(source, '0'), 30);
    return { retval: r.sim.result?.retval ?? xdr.ScVal.scvVoid(), auth: r.auth, ledger: r.sim.latestLedger, minResourceFee: r.sim.minResourceFee, readWriteCount: r.readWriteCount, latencyMs: r.latencyMs };
  }

  async buildTx(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx> {
    const { server } = this.net(network);
    const account = await this.guard(network, async () => {
      try { return await server.getAccount(source); }
      catch (e) { if (/not found|404/i.test(String((e as Error).message))) throw sourceNotFound(source); throw e; }
    });
    const r = await this.simulateRaw(network, id, fn, args, account, opts.timeoutS);
    const assembled = rpc.assembleTransaction(r.tx, r.sim).build();
    const fee = opts.fee ?? assembled.fee;
    return { xdr: assembled.toXdr(), fee, auth: r.auth, ledger: r.sim.latestLedger, expiresAt: new Date(Date.now() + opts.timeoutS * 1000).toISOString() };
  }

  private toStatus(hash: string, r: rpc.Api.GetTransactionResponse): TxStatus {
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash, status: 'success', ledger: r.ledger, feeCharged: String(r.resultXdr.feeCharged), resultXdr: r.returnValue?.toXdr('base64') };
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) return { hash, status: 'failed', ledger: r.ledger, resultXdr: r.resultXdr.toXdr('base64') };
    return { hash, status: 'pending' };
  }

  async submit(network: Network, xdrB64: string, waitMs: number): Promise<TxStatus> {
    const { server, passphrase } = this.net(network);
    let tx; try { tx = TransactionBuilder.fromXdr(xdrB64, passphrase); } catch { throw new ChainError(400, 'invalid_xdr', 'xdr is not a valid transaction envelope for this network'); }
    const sent = await this.guard(network, () => server.sendTransaction(tx));
    if (sent.status === 'ERROR' || sent.status === 'DUPLICATE' || sent.status === 'TRY_AGAIN_LATER')
      throw new ChainError(422, 'submit_rejected', `transaction rejected: ${sent.status}`, { details: { errorResult: sent.errorResult?.toXdr('base64') } });
    const deadline = Date.now() + waitMs;
    let last: TxStatus = { hash: sent.hash, status: 'pending' };
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      last = this.toStatus(sent.hash, await this.guard(network, () => server.getTransaction(sent.hash)));
      if (last.status !== 'pending') break;
    }
    return last;
  }

  async getTx(network: Network, hash: string): Promise<TxStatus> {
    const { server } = this.net(network);
    const r = await this.guard(network, () => server.getTransaction(hash));
    if (r.status === rpc.Api.GetTransactionStatus.NOT_FOUND) throw new ChainError(404, 'tx_not_found', `transaction ${hash} not found`);
    return this.toStatus(hash, r);
  }

  async health(network: Network): Promise<'ok' | 'error'> {
    try { const { server } = this.net(network); await server.getHealth(); return 'ok'; } catch { return 'error'; }
  }
}
