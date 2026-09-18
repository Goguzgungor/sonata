export const SITE_URL = 'https://sonata.brages.uk';
export const API_URL = 'https://api.sonata.brages.uk';
export const CONTRACT_ID = 'CGA4VK53W6R2XPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4R';
export const MCP_URL = API_URL + '/c/CGA4…D4R/mcp';
export const XDR = 'AAAAAgAAAADzKF2C7SFK3D5TPZ2XQ7WVN6M6ABCD4RXPLZ7SM3NQ7TRH24AAAAZAACv1MAAAAkAAAAAQAAAAAAAAAAAAAAAGjA0uMAAAAAAAAAAQAAAAAAAAAYAAAAAAAAAAEidHJhbnNmZXIiLCBHQlg3, R0NLMiwgMTI1MCBVU0RD…';
export const MCP_CONFIG = `{
  "mcpServers": {
    "sonata-stellarswap": {
      "url": "${MCP_URL}",
      "type": "http"
    }
  }
}`;
export const LLMS = `# StellarSwap

Soroban AMM + token contract. 14 functions · SEP-48.

## Functions
balance(id: Address) → i128
transfer(from, to, amount: i128) → void
swap(from, sell, buy, amount: i128) → i128

## Types
SwapRequest { sell, buy, amount: i128 }
Reserve { token: Address, total: i128 }

## Errors
1 InsufficientBalance · 2 SlippageExceeded

## Events
transfer(from, to, amount) · swap(who, sold, bought)`;

/* [time, event, decoded call, ledger, success] */
export const EV = [
  ['2m ago', 'transfer', 'transfer(GBX7…4Q9, GCK2…M8P, 1,250 USDC)', '48,192,044', 1],
  ['9m ago', 'swap', 'swap(GDQ5…7LA, 400 XLM, 92.1 USDC)', '48,191,910', 1],
  ['14m ago', 'deposit', 'deposit(GA3F…2RT, 10,000 XLM)', '48,191,802', 0],
  ['31m ago', 'transfer', 'transfer(GCK2…M8P, GBX7…4Q9, 300 USDC)', '48,191,540', 1],
  ['1h ago', 'withdraw', 'withdraw(GA3F…2RT, 2,500 XLM)', '48,190,988', 1],
  ['2h ago', 'swap', 'swap(GBX7…4Q9, 1,000 USDC, 4,310 XLM)', '48,190,120', 1],
  ['3h ago', 'mint', 'mint(GDQ5…7LA, 50,000 USDC)', '48,189,776', 1],
  ['5h ago', 'approve', 'approve(GCK2…M8P, GA3F…2RT, 800 USDC)', '48,188,902', 1],
  ['8h ago', 'transfer', 'transfer(GA3F…2RT, GDQ5…7LA, 75 XLM)', '48,187,431', 0],
  ['12h ago', 'deposit', 'deposit(GBX7…4Q9, 20,000 XLM)', '48,185,650', 1]
];
export const ADDR_EV = EV.filter((e) => e[2].indexOf('GBX7') >= 0);
export const EV_COLS = [
  { key: 'time', header: 'Time', width: '90px', mono: true },
  { key: 'event', header: 'Event', width: '120px', strong: true },
  { key: 'call', header: 'Decoded call', mono: true },
  { key: 'ledger', header: 'Ledger', width: '120px', mono: true },
  { key: 'status', header: 'Status', width: '150px', align: 'right' }
];
export const ADDR_COLS = [
  { key: 'time', header: 'Time', width: '80px', mono: true },
  { key: 'event', header: 'Event', width: '110px', strong: true },
  { key: 'ledger', header: 'Ledger', width: '110px', mono: true },
  { key: 'status', header: 'Status', width: '140px', align: 'right' }
];

/* [name, signature, isWrite] */
export const FN = [
  ['balance', 'balance(id: Address) → i128', 0],
  ['transfer', 'transfer(from: Address, to: Address, amount: i128) → void', 1],
  ['swap', 'swap(from: Address, sell: Address, buy: Address, amount: i128) → i128', 1],
  ['deposit', 'deposit(from: Address, amount: i128) → void', 1],
  ['withdraw', 'withdraw(from: Address, amount: i128) → void', 1],
  ['allowance', 'allowance(from: Address, spender: Address) → i128', 0],
  ['approve', 'approve(from: Address, spender: Address, amount: i128) → void', 1],
  ['mint', 'mint(to: Address, amount: i128) → void', 1]
];
export const FN_COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'fn', header: 'Function', width: '150px', strong: true },
  { key: 'sig', header: 'Signature', mono: true },
  { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];

/* [tool, source, isWrite] */
export const TL = [
  ['balance', 'contract', 0], ['transfer', 'contract', 1], ['swap', 'contract', 1], ['deposit', 'contract', 1],
  ['get_contract_history', 'history', 0], ['get_events', 'history', 0], ['get_address_activity', 'history', 0], ['get_stats', 'history', 0]
];
export const TOOL_COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'tool', header: 'Tool', width: '240px', strong: true },
  { key: 'src', header: 'Source', mono: true },
  { key: 'kind', header: 'Kind', width: '110px' },
  { key: 'on', header: 'Enabled', width: '110px', align: 'right' }
];

export const TAB_LABEL = { overview: 'Overview', functions: 'Functions', mcp: 'MCP', docs: 'Docs', history: 'History' };
export const NET_OPTS = [{ value: 'testnet', label: 'Testnet' }, { value: 'mainnet', label: 'Mainnet' }];
export const SIM_OPTS = [{ value: 'sim', label: 'Simulate' }, { value: 'build', label: 'Build transaction' }];
export const MCP_OPTS = [{ value: 'ro', label: 'Read only' }, { value: 'rw', label: 'Read + write' }];
export const HIST_OPTS = [{ value: 'all', label: 'All' }, { value: 'transfer', label: 'transfer' }, { value: 'swap', label: 'swap' }, { value: 'deposit', label: 'deposit' }];

export const WELCOME_ROWS = [
  { name: 'REST API', d: 'Every contract function becomes an HTTP endpoint.' },
  { name: 'MCP server', d: 'Typed tools any AI agent can call.' },
  { name: 'AI-ready docs', d: 'A compact llms.txt generated from the contract spec.' },
  { name: 'Indexed history', d: 'Every past event and transaction, decoded and queryable.' }
];
export const PIPE = [
  { name: 'Fetch WASM from network', d: 'Ledger 48,192,044 · 128.4 KB' },
  { name: 'Parse SEP-48 contract spec', d: '14 functions · 4 types · 6 errors' },
  { name: 'Generate REST API + MCP + docs', d: 'OpenAPI 3.1 · 18 MCP tools' },
  { name: 'Index on-chain history', d: 'Indexing 4,920 past events…' }
];
export const CONTRACTS = [
  { name: 'StellarSwap', id: CONTRACT_ID, calls: '1,284 calls · 24h', when: '2m ago', net: 'Testnet', netTone: 'neutral', st: 'Indexed', stTone: 'good' },
  { name: 'YieldVault', id: 'CB6QR2M6WVN6M6ABCD4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XM2P4KX', calls: '312 calls · 24h', when: '26m ago', net: 'Mainnet', netTone: 'inverse', st: 'Indexed', stTone: 'good' },
  { name: 'USDC Stream', id: 'CD2PQ7WVN6M6ABCD4RXPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7N6KTF', calls: '88 calls · 24h', when: '1h ago', net: 'Testnet', netTone: 'neutral', st: 'Indexing', stTone: 'warning' }
];
export const SURFACES = [
  { name: 'REST API', d: '14 endpoints · /call · /tx · /submit', href: '/c/functions' },
  { name: 'MCP server', d: '18 tools · read-only by default', href: '/c/mcp' },
  { name: 'Docs', d: 'Markdown · llms.txt', href: '/c/docs' },
  { name: 'History', d: '4,920 events · Mercury · CSV / JSON', href: '/c/history' }
];
export const BAR_VALS = [34, 41, 28, 45, 39, 52, 31, 44, 48, 36, 50, 42, 46, 58];
