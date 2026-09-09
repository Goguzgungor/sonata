/* Public contracts indexed by Sonata (sample data). */
export const CATEGORIES = ['All', 'DEX / AMM', 'Token', 'Lending', 'Infrastructure', 'Payments'];

export const EXPLORER_SORTS = [
  { value: 'active', label: 'Most active' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'verified', label: 'Verified' }
];

export const PUBLIC_CONTRACTS = [
  { id: 'CGA4VK53W6R2XPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4R', name: 'StellarSwap', owner: 'sonata', category: 'DEX / AMM', net: 'Testnet', d: 'Soroban AMM + token contract. 14 functions, SEP-48.', calls: 128400, updated: '2026-09-09', added: '2026-03-18', verified: true, docs: true, fns: 14, tools: 18 },
  { id: 'CB6QR2M6WVN6M6ABCD4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6', name: 'YieldVault', owner: 'sonata', category: 'Lending', net: 'Mainnet', d: 'Single-asset vault with time-weighted rewards.', calls: 31200, updated: '2026-09-08', added: '2026-05-02', verified: true, docs: true, fns: 9, tools: 12 },
  { id: 'CD2PQ7WVN6M6ABCD4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6', name: 'USDC Stream', owner: 'community', category: 'Payments', net: 'Testnet', d: 'Streaming payments with per-second vesting and cancel.', calls: 8800, updated: '2026-09-07', added: '2026-08-27', verified: false, docs: true, fns: 7, tools: 9 },
  { id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC', name: 'Stellar Asset Contract', owner: 'system', category: 'Token', net: 'Mainnet', d: 'The built-in SAC interface for classic Stellar assets.', calls: 412000, updated: '2026-08-29', added: '2026-01-10', verified: true, docs: true, fns: 12, tools: 14 },
  { id: 'CSOROSWAP4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4R2', name: 'Soroswap Router', owner: 'system', category: 'DEX / AMM', net: 'Mainnet', d: 'Auto-imported from on-chain spec. Multi-hop swaps and liquidity.', calls: 96500, updated: '2026-09-01', added: '2026-02-14', verified: true, docs: false, fns: 11, tools: 13 },
  { id: 'CBLEND4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RQ7WV', name: 'Blend Pool', owner: 'system', category: 'Lending', net: 'Mainnet', d: 'Isolated lending pool. Supply, borrow, liquidate.', calls: 74100, updated: '2026-08-30', added: '2026-02-20', verified: true, docs: true, fns: 16, tools: 20 },
  { id: 'CPHOENIX7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RXPLZ7Q7W', name: 'Phoenix Multihop', owner: 'community', category: 'DEX / AMM', net: 'Mainnet', d: 'Auto-imported from on-chain spec.', calls: 22300, updated: '2026-08-21', added: '2026-06-11', verified: false, docs: false, fns: 6, tools: 8 },
  { id: 'CORACLE4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RQ7WV', name: 'Reflector Oracle', owner: 'system', category: 'Infrastructure', net: 'Mainnet', d: 'Price feeds with TWAP and last-price reads.', calls: 158000, updated: '2026-09-05', added: '2026-01-28', verified: true, docs: true, fns: 8, tools: 8 },
  { id: 'CBRIDGE7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RXPLZ7Q7WV', name: 'Allbridge Core', owner: 'system', category: 'Infrastructure', net: 'Mainnet', d: 'Cross-chain bridge messenger. No description provided.', calls: 40900, updated: '2026-07-30', added: '2026-04-03', verified: false, docs: false, fns: 10, tools: 11 },
  { id: 'CTOKEN22RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RQ7WV', name: 'Wrapped XLM', owner: 'sonata', category: 'Token', net: 'Testnet', d: 'SEP-41 token with mint and burn for testing.', calls: 12700, updated: '2026-09-06', added: '2026-08-30', verified: true, docs: true, fns: 10, tools: 11 },
  { id: 'CTIP4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RQ7WVN6M', name: 'Tip Jar', owner: 'community', category: 'Payments', net: 'Testnet', d: 'Minimal tipping contract used in the quickstart.', calls: 2100, updated: '2026-09-03', added: '2026-09-01', verified: false, docs: true, fns: 3, tools: 4 },
  { id: 'CESCROW7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4RXPLZ7Q7WVN', name: 'Escrow', owner: 'community', category: 'Payments', net: 'Mainnet', d: 'Two-party escrow with arbiter release.', calls: 5600, updated: '2026-08-12', added: '2026-07-19', verified: false, docs: false, fns: 5, tools: 6 }
];

export const CONTRACT_BY_ID = Object.fromEntries(PUBLIC_CONTRACTS.map((c) => [c.id, c]));

export const shortId = (id) => id.slice(0, 4) + '…' + id.slice(-3);
export const fmt = (n) => n.toLocaleString('en-US');

/* Function list shown on the public contract page (sample). */
export const PUBLIC_FNS = [
  ['balance', 'balance(id: Address) → i128', false],
  ['allowance', 'allowance(from: Address, spender: Address) → i128', false],
  ['transfer', 'transfer(from, to: Address, amount: i128) → void', true],
  ['approve', 'approve(from, spender: Address, amount: i128) → void', true],
  ['swap', 'swap(from: Address, sell, buy: Address, amount: i128) → i128', true],
  ['deposit', 'deposit(from: Address, amount: i128) → void', true]
];
