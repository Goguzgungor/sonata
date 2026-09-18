import { ApiError } from '../errors.js';

export class ChainError extends ApiError {}

export const rpcUnavailable = (network: string, cause: unknown) =>
  new ChainError(502, 'rpc_unavailable', `RPC for ${network} unavailable: ${(cause as Error)?.message ?? String(cause)}`);
export const networkNotConfigured = (network: string) =>
  new ChainError(400, 'network_not_configured', `network ${network} is not configured on this server`);
export const contractNotFound = (network: string, id: string) =>
  new ChainError(404, 'contract_not_found', `contract ${id} does not exist on ${network}`);
export const sourceNotFound = (source: string) =>
  new ChainError(400, 'source_not_found', `source account ${source} does not exist on this network`);
export const sacUnsupported = (id: string) =>
  new ChainError(400, 'sac_unsupported', `contract ${id} is a Stellar Asset Contract (SAC) — it has no WASM spec; SAC support arrives in a later release`);
/** stellar-sdk 17 rejects a SAC from getContractWasmByContractId with an Error carrying this phrase. */
export const isSacError = (e: unknown) => /Stellar Asset Contract/i.test(String((e as Error)?.message ?? e));

export function parseSimulationError(msg: string): { kind: 'contract'; code: number } | { kind: 'host'; message: string } {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  return m ? { kind: 'contract', code: Number(m[1]) } : { kind: 'host', message: msg };
}
