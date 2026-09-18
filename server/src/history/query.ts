import { StrKey, xdr } from '@stellar/stellar-sdk';
import { badRequest } from '../errors.js';
import { rangeOutOfRetention } from '../chain/errors.js';
import type { Retention } from './types.js';

export const DEFAULT_WINDOW_LEDGERS = 17_280;   // ≈ 24 h at 5 s
export const LEDGER_SECONDS = 5.5;
export type Normalised = { type?: string; address?: string; fromLedger: number; toLedger: number; cursor?: string; limit: number; format: 'json' | 'csv' };
/** `type` is matched on topic[0]; the RPC needs one filter per topic count, so cover 1–4 topics with wildcards. */
export const topicFilters = (symbol: string): string[][] => { const s = xdr.ScVal.scvSymbol(symbol).toXDR('base64'); return [[s], [s, '*'], [s, '*', '*'], [s, '*', '*', '*']]; };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function toLedger(v: unknown, path: string, r: Retention): number {
  if (typeof v !== 'string' || v === '') throw badRequest('invalid_args', `${path} must be a ledger sequence or an ISO-8601 time`, { path });
  if (/^\d+$/.test(v)) return Number(v);
  const t = Date.parse(v); if (Number.isNaN(t)) throw badRequest('invalid_args', `${path} must be a ledger sequence or an ISO-8601 time`, { path });
  return r.latestLedger - Math.round((Date.parse(r.latestLedgerCloseTime) - t) / 1000 / LEDGER_SECONDS);
}
export function normaliseQuery(raw: Record<string, unknown>, r: Retention): Normalised {
  const limit = raw.limit === undefined ? 50 : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw badRequest('invalid_args', 'limit must be an integer between 1 and 200', { path: 'limit' });
  const format = raw.format === undefined ? 'json' : raw.format;
  if (format !== 'json' && format !== 'csv') throw badRequest('invalid_args', 'format must be json or csv', { path: 'format' });
  const address = raw.address === undefined ? undefined : String(raw.address);
  if (address !== undefined && !StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) throw badRequest('invalid_args', 'address must be a G… or C… address', { path: 'address' });
  const type = raw.type === undefined ? undefined : String(raw.type);
  if (type !== undefined && !/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(type)) throw badRequest('invalid_args', 'type must be an event name (symbol)', { path: 'type' });
  const rawTo = raw.to === undefined ? r.latestLedger : toLedger(raw.to, 'to', r);
  const rawFrom = raw.from === undefined ? rawTo - DEFAULT_WINDOW_LEDGERS : toLedger(raw.from, 'from', r);
  if (rawFrom > rawTo) throw badRequest('invalid_args', 'to must not be before from', { path: 'to' });
  if (rawTo < r.oldestLedger) throw rangeOutOfRetention(r.oldestLedger, r.latestLedger);
  const fromLedger = clamp(rawFrom, r.oldestLedger, r.latestLedger), toLedger_ = clamp(rawTo, r.oldestLedger, r.latestLedger);
  return { type, address, fromLedger, toLedger: toLedger_, cursor: raw.cursor === undefined ? undefined : String(raw.cursor), limit, format };
}
