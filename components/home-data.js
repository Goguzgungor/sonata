import { CONTRACT_ID, MCP_URL, MCP_CONFIG, API_URL } from './data';

export const HOME_STATS = [
  { label: 'Contract to hosted API', value: '30', unit: 's' },
  { label: 'MCP tools per contract', value: '18' },
  { label: 'SDKs required', value: '0' },
  { label: 'Contracts indexed', value: '1,204', note: 'Testnet + Mainnet' }
];

export const HOME_STEPS = [
  { name: 'Register a contract', d: 'Paste a Soroban contract ID. Sonata reads the SEP-48 spec and indexes every function, type, error and event.' },
  { name: 'Generate surfaces', d: 'REST endpoints, an MCP server, llms.txt docs and an indexed event history are published under one URL.' },
  { name: 'Connect apps + agents', d: 'Backends, mobile apps, Claude, Cursor and autonomous agents call your contract over plain HTTP.' }
];

export const HOME_SURFACES = [
  { audience: 'Backend teams', name: 'Hosted REST API', d: 'Call any contract function with JSON. Sonata handles XDR encoding, simulation and fee estimation.', endpoint: 'POST /c/' + CONTRACT_ID.slice(0, 4) + '…D4R/call/balance' },
  { audience: 'AI agents', name: 'MCP server', d: 'Search, docs, reads, simulation and transaction building exposed as tools to Claude, Cursor and Codex.', endpoint: 'build_transaction({ contract, fn, args })' },
  { audience: 'Context windows', name: 'AI-ready docs', d: 'A compact llms.txt generated from the contract spec so humans and models understand it in one read.', endpoint: 'GET /c/CGA4…D4R/llms.txt' },
  { audience: 'Analytics', name: 'Indexed history', d: 'Decoded events and calls, filterable by address and time, exportable as CSV or JSON.', endpoint: 'GET /c/CGA4…D4R/events?address=G…' }
];

export const HOME_CURL = `API=${API_URL}

curl -X POST "$API/c/${CONTRACT_ID.slice(0, 4)}…D4R/tx/transfer" \\
  -H "Content-Type: application/json" \\
  -d '{
    "args": { "from": "GBX7…4Q9", "to": "GCK2…M8P", "amount": "1250000000" },
    "network": "testnet"
  }'

# -> { "xdr": "AAAAAgAAAADzKF2C…", "fee": "100" }`;

export const HOME_MCP = MCP_CONFIG + `

# or
claude mcp add --transport http sonata ${MCP_URL}`;
