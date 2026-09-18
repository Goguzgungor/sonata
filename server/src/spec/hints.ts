import type { FnKind } from '../types.js';

const READ_EXACT = new Set(['balance', 'allowance', 'total_supply', 'decimals', 'name', 'symbol', 'admin', 'owner', 'version', 'spec']);
const READ_PREFIX = ['get_', 'is_', 'has_', 'query_', 'read_', 'view_', 'total_', 'list_'];
const READ_SUFFIX = ['_of', '_at', '_for'];
const SIGNER_NAMES = new Set(['from', 'admin', 'owner', 'sender', 'caller', 'signer', 'user', 'account', 'spender']);

export function classifyByName(name: string, inputs: Array<{ name: string; type: string }>): FnKind {
  const n = name.toLowerCase();
  if (READ_EXACT.has(n) || READ_PREFIX.some((p) => n.startsWith(p)) || READ_SUFFIX.some((s) => n.endsWith(s))) return 'read';
  if (inputs.some((i) => i.type === 'Address' && SIGNER_NAMES.has(i.name.toLowerCase()))) return 'write';
  return 'unknown';
}
