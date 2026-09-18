const KINDS = new Set(['contract', 'account', 'tx']);
/** Deep link into stellar.expert for a contract, account or transaction on the given Sonata network. */
export function expertUrl(network, kind, value) {
  if (!KINDS.has(kind)) throw new RangeError(`unknown explorer kind: ${kind}`);
  return `https://stellar.expert/explorer/${network === 'mainnet' ? 'public' : 'testnet'}/${kind}/${encodeURIComponent(value)}`;
}
