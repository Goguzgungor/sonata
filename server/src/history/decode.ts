import { contract, scValToNative, xdr } from '@stellar/stellar-sdk';
import { toJson } from '../spec/codec.js';
import type { Network } from '../types.js';
import type { RawEvent } from './types.js';

export type DecodedEvent = { id: string; ledger: number; closed_at: string; tx_hash: string; successful: boolean; event: string | null; topics: unknown[]; data: unknown; raw: { topic: string[]; value: string }; explorer_url: string };

/** The JSON-ish shape contract.Spec exposes for `#[contractevent]` entries (same access pattern as spec/model.ts). */
type EventSpec = { name: string; prefix_topics: string[]; params: Array<{ name: string; location: 'topic_list' | 'data'; type: unknown }>; data_format: 'map' | 'vec' | 'single_value' };
// In this SDK build, `entry.value` for a real (parsed-from-wasm) spec is still an XDR value object —
// camelCased fields (`prefixTopics`, `dataFormat`), name as an XdrString, `dataFormat`/`location` as
// enum instances — not the plain snake_case JSON the value carries logically. Its `.toJson()` renders
// that plain SEP-0051 (snake_case) shape, matching EventSpec exactly. Fixture specs built directly as
// plain objects (as in decode.test.ts's `fakeSpec`) have no `.toJson` and are already in that shape.
const asEventSpec = (v: unknown): EventSpec => (typeof (v as { toJson?: unknown }).toJson === 'function' ? ((v as { toJson(): unknown }).toJson() as EventSpec) : (v as EventSpec));
const eventSpecs = (spec: contract.Spec): EventSpec[] =>
  (spec.entries as unknown as Array<{ type: string; value: unknown }>).filter((e) => e.type === 'scSpecEntryEventV0').map((e) => asEventSpec(e.value));
const findEvent = (spec: contract.Spec, symbol: string) => { const k = symbol.toLowerCase(); return eventSpecs(spec).find((e) => e.name.toLowerCase() === k || (e.prefix_topics[0] ?? '').toLowerCase() === k); };

/** `type` as the user typed it (declared name `Pinged`, prefix topic `pinged`, any case) → the on-chain symbol; unknown names pass through unchanged. */
export const resolveTopic = (spec: contract.Spec, type: string): string => findEvent(spec, type)?.prefix_topics[0] ?? type;

const dec = (b64: string): unknown => toJson(scValToNative(xdr.ScVal.fromXDR(b64, 'base64')));
const safe = (f: () => unknown): { ok: true; v: unknown } | { ok: false } => { try { return { ok: true, v: f() }; } catch { return { ok: false }; } };

/** Topics decoded in order; data named by the declared event's `data` params for vec/single_value formats (map data is already keyed), else the plain decoded value, else null. */
export function decodeEvent(raw: RawEvent, spec: contract.Spec, network: Network): DecodedEvent {
  const topics = raw.topic.map((t) => { const r = safe(() => dec(t)); return r.ok ? r.v : null; });
  const event = typeof topics[0] === 'string' ? topics[0] : null;
  const value = safe(() => dec(raw.value));
  let data: unknown = value.ok ? value.v : null;
  const decl = event ? findEvent(spec, event) : undefined;
  if (decl && value.ok) {
    const dataParams = decl.params.filter((p) => p.location === 'data');
    if (decl.data_format === 'single_value' && dataParams.length === 1) data = { [dataParams[0].name]: value.v };
    else if (decl.data_format === 'vec' && Array.isArray(value.v) && value.v.length === dataParams.length) data = Object.fromEntries(dataParams.map((p, i) => [p.name, (value.v as unknown[])[i]]));
  }
  return { id: raw.id, ledger: raw.ledger, closed_at: raw.closedAt, tx_hash: raw.txHash, successful: raw.inSuccessfulContractCall, event, topics, data, raw: { topic: raw.topic, value: raw.value },
    explorer_url: `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/tx/${raw.txHash}` };
}
const contains = (v: unknown, needle: string): boolean => v === needle || (Array.isArray(v) ? v.some((x) => contains(x, needle)) : !!v && typeof v === 'object' && Object.values(v as object).some((x) => contains(x, needle)));
export const matchesAddress = (ev: DecodedEvent, address: string) => contains(ev.topics, address) || contains(ev.data, address);
