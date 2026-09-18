import type { ContractModel, FnKind } from '../types.js';
import type { Registry } from './registry.js';

/** Structural, not `pino.Logger`: the REST route's `req.log` (Fastify's logger interface) and the
 * MCP servers' `deps.log` (a concrete pino.Logger) both satisfy this without a cast. */
type Warner = { warn(obj: unknown, msg?: string): void };

/**
 * Whether a freshly observed read/write kind should overwrite the stored hint. Monotonic:
 *  - `unknown` stored → always learn (there is nothing to lose).
 *  - `read` stored, `write` observed → learn (auth/footprint proves it actually writes).
 *  - `write` stored → never downgraded back to `read`. One simulation with no signer attached
 *    does not prove a write function is safe to reclassify, and flip-flopping the hint on every
 *    call is worse than a stale `write` label (review finding: hint learning could flip-flop).
 */
export function shouldLearn(stored: FnKind, observed: 'read' | 'write'): boolean {
  return stored === 'unknown' || (stored === 'read' && observed === 'write');
}

/**
 * Learns `fn`'s observed kind onto `model`'s stored hint when shouldLearn() allows it. Shared by
 * the REST `/call` route and the MCP `call`/`call_<fn>` tools so the monotonic rule lives once
 * (review finding: the block was duplicated and could diverge). Swallows and logs store failures —
 * a failed hint write must never fail the call itself.
 */
export async function learnKind(deps: { registry: Pick<Registry, 'learnHint'> }, model: ContractModel, fn: string, observed: 'read' | 'write', log: Warner) {
  const stored = model.functions.find((f) => f.name === fn)!.kind;
  if (!shouldLearn(stored, observed)) return;
  try { await deps.registry.learnHint(model.id, fn, observed); } catch (e) { log.warn({ err: e }, 'hint'); }
}
