import { contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { toJson } from '../spec/codec.js';
import type { Network } from '../types.js';
import type { RawEvent } from './types.js';
import { topicFilters } from './query.js';

export type DecodedEvent = { id: string; ledger: number; closed_at: string; tx_hash: string; successful: boolean; event: string | null; topics: unknown[]; data: unknown; raw: { topic: string[]; value: string }; explorer_url: string };

/**
 * Resolves `type` (a declared event name, a prefix topic, or an arbitrary on-chain symbol) to the
 * symbol `getEvents` topic filters should match on: if `type` names a declared SEP-48 event
 * (case-insensitively, by declared name or first prefix topic), returns that event's first prefix
 * topic — the symbol actually emitted on-chain for it. Otherwise returns `type` unchanged.
 */
export const resolveSymbol = (spec: contract.Spec, type: string): string => {
  const k = type.toLowerCase();
  const decl = spec.events().find((e) => e.name.toString().toLowerCase() === k || (e.prefixTopics[0]?.toString() ?? '').toLowerCase() === k);
  return decl?.prefixTopics[0] ? decl.prefixTopics[0].toString() : type;
};

/**
 * Builds a `getEvents` topic filter for `type`: resolves it to a symbol via `resolveSymbol`, then
 * emits `topicFilters`' four arity-covering wildcard rows (1–4 topics) for it. stellar-rpc matches a
 * topic filter row only against events with exactly that many topics, and a declared event's topic
 * list can be shorter than what the contract actually emits on-chain — e.g. the built-in SAC's
 * `Transfer` spec declares 3 topics (`[transfer, from, to]`) but on-chain SAC `transfer` events carry
 * a 4th (the SEP-11 asset code), so an exact-arity filter built from the spec alone silently empties
 * the page for every SAC transfer/approve (review finding C1, verified live on testnet). Emitting all
 * four arities is always correct even for exact matches: `Spec.parseEvent`, which decodes the matched
 * events, tolerates extra topics.
 */
export const topicFiltersFor = (spec: contract.Spec, type: string): string[][] => topicFilters(resolveSymbol(spec, type));

const dec = (b64: string): unknown => toJson(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')));
const safe = (f: () => unknown): { ok: true; v: unknown } | { ok: false } => { try { return { ok: true, v: f() }; } catch { return { ok: false }; } };

/**
 * Topics decoded generically, in order (`event` is `topics[0]` when it's a string). Data is
 * decoded via the SDK's SEP-48 `Spec.parseEvent` (topic-list and data params merged by name)
 * when a declared event spec matches; otherwise the plain decoded value; `null` if undecodable.
 */
export function decodeEvent(raw: RawEvent, spec: contract.Spec, network: Network): DecodedEvent {
  const topics = raw.topic.map((t) => { const r = safe(() => dec(t)); return r.ok ? r.v : null; });
  const event = typeof topics[0] === 'string' ? topics[0] : null;
  const parsed = safe(() => spec.parseEvent(raw.topic, raw.value));
  let data: unknown;
  if (parsed.ok && parsed.v) data = toJson((parsed.v as contract.ParsedEvent).data);
  else { const value = safe(() => dec(raw.value)); data = value.ok ? value.v : null; }
  return { id: raw.id, ledger: raw.ledger, closed_at: raw.closedAt, tx_hash: raw.txHash, successful: raw.inSuccessfulContractCall, event, topics, data, raw: { topic: raw.topic, value: raw.value },
    explorer_url: `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/tx/${raw.txHash}` };
}
const contains = (v: unknown, needle: string): boolean => v === needle || (Array.isArray(v) ? v.some((x) => contains(x, needle)) : !!v && typeof v === 'object' && Object.values(v as object).some((x) => contains(x, needle)));
export const matchesAddress = (ev: DecodedEvent, address: string) => contains(ev.topics, address) || contains(ev.data, address);
