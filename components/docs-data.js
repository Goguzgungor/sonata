const DEMO_API_URL = 'https://api.sonata.brages.uk';
const CONTRACT_ID = 'CGA4VK53W6R2XPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4R';
const MCP_URL = DEMO_API_URL + '/c/CGA4…D4R/mcp';
const MCP_CONFIG = `{
  "mcpServers": {
    "sonata-stellarswap": {
      "url": "${MCP_URL}",
      "type": "http"
    }
  }
}`;
const LLMS = `# StellarSwap

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

const SHORT = CONTRACT_ID.slice(0, 4) + '…D4R';

/* Each doc page: slug, title, intro, sections[]. Blocks: p | code | list | kv */
export const DOCS = [
  {
    slug: 'overview', title: 'Overview', nav: 'Overview',
    intro: 'Sonata turns any Soroban contract into a hosted API, an MCP server, AI-ready docs and an indexed event history. Nothing to deploy, no SDK, no custody.',
    sections: [
      { h: 'What you get', blocks: [
        { list: [
          'A REST API for every function in the contract, with simulation and unsigned XDR building.',
          'An MCP server so Claude, Cursor and Codex can read, simulate and build transactions.',
          'An llms.txt document generated from the SEP-48 spec.',
          'An indexed, decoded history of events and calls.',
          'Flows: published recipes that build a whole transaction from a few inputs.'
        ] }
      ] },
      { h: 'How it fits together', blocks: [
        { p: 'You register a contract once. Sonata reads its spec, publishes the four surfaces under a single base URL and keeps the history indexed as new ledgers close.' },
        { kv: [
          { key: 'Base URL', value: DEMO_API_URL },
          { key: 'Contract path', value: '/c/{contractId}' },
          { key: 'Networks', value: 'testnet · mainnet', mono: false },
          { key: 'Auth', value: 'None in the preview build', mono: false }
        ] }
      ] },
      { h: 'Preview build', blocks: [
        { p: 'This site is a preview. Every number and response you see is sample data and no transaction is sent to the network. The API shapes documented here are the ones the production service will expose.' }
      ] }
    ]
  },
  {
    slug: 'quickstart', title: 'Quickstart', nav: 'Quickstart',
    intro: 'From a contract ID to a working call in about thirty seconds.',
    sections: [
      { h: '1. Connect and register', blocks: [
        { p: 'Connect a Freighter wallet, open Contracts and choose Add a contract. Paste the contract ID and pick a network. The pipeline reads the spec, generates the surfaces and indexes history.' }
      ] },
      { h: '2. Make a read call', blocks: [
        { code: `curl -X POST "${DEMO_API_URL}/c/${SHORT}/call/balance" \\
  -H "Content-Type: application/json" \\
  -d '{ "args": { "id": "GBX7…4Q9" } }'

# -> { "result": { "balance": "1250000000" }, "simulated": true }` }
      ] },
      { h: '3. Build and sign a write', blocks: [
        { p: 'Write functions return unsigned XDR. Sign it with Freighter or any Stellar signer and submit it yourself, or let the MCP tool hand it to your agent.' },
        { code: `curl -X POST "${DEMO_API_URL}/c/${SHORT}/tx/transfer" \\
  -d '{ "args": { "from": "GBX7…4Q9", "to": "GCK2…M8P", "amount": "1250000000" } }'

# -> { "xdr": "AAAAAgAAAADzKF2C…", "fee": "100" }` }
      ] }
    ]
  },
  {
    slug: 'api', title: 'REST API', nav: 'REST API',
    intro: 'Every contract function becomes an HTTP endpoint. Reads are simulated; writes return unsigned XDR.',
    sections: [
      { h: 'Endpoints', blocks: [
        { kv: [
          { key: 'GET /c/{id}', value: 'Contract summary and spec' , mono: false },
          { key: 'POST /c/{id}/call/{fn}', value: 'Simulate a read function', mono: false },
          { key: 'POST /c/{id}/tx/{fn}', value: 'Build unsigned XDR for a write', mono: false },
          { key: 'GET /c/{id}/events', value: 'Decoded events, filterable', mono: false },
          { key: 'GET /c/{id}/llms.txt', value: 'AI-ready docs', mono: false },
          { key: 'POST /flows/{slug}/build', value: 'Build a transaction from a flow', mono: false }
        ] }
      ] },
      { h: 'Request body', blocks: [
        { p: 'Arguments are passed by name and encoded from the spec types. Addresses are strings, integers are strings to preserve i128 precision.' },
        { code: `{
  "args": { "from": "G…", "to": "G…", "amount": "1250000000" },
  "network": "testnet",
  "source": "G…"
}` }
      ] },
      { h: 'Responses', blocks: [
        { code: `// read
{ "result": { "balance": "1250000000" }, "simulated": true, "latency_ms": 42 }

// write
{ "xdr": "AAAAAgAAAADzKF2C…", "fee": "100", "auth": ["from"] }

// error
{ "error": "SlippageExceeded", "code": 2 }` }
      ] },
      { h: 'Authentication and limits', blocks: [
        { p: 'The preview build needs no authentication. Rate limits and per-key usage arrive with the production release.' }
      ] }
    ]
  },
  {
    slug: 'mcp', title: 'MCP server', nav: 'MCP server',
    intro: 'Give Claude, Cursor or Codex contract-level tools without writing a single wrapper.',
    sections: [
      { h: 'Connect', blocks: [
        { p: 'Every contract exposes its own MCP endpoint over HTTP. Paste the config into your client or run the one-liner.' },
        { code: MCP_CONFIG + `

claude mcp add --transport http sonata-stellarswap ${MCP_URL}` }
      ] },
      { h: 'Tools', blocks: [
        { kv: [
          { key: 'search_functions', value: 'Find functions by name or purpose', mono: false },
          { key: 'get_docs', value: 'Return llms.txt for the contract', mono: false },
          { key: 'call_{fn}', value: 'Simulate a read function', mono: false },
          { key: 'build_{fn}', value: 'Build unsigned XDR for a write', mono: false },
          { key: 'get_events', value: 'Query decoded history', mono: false }
        ] },
        { p: 'Write tools stay disabled until you switch the scope to Read + write in the workspace. Agents never hold keys: they receive XDR and hand it to a signer.' }
      ] }
    ]
  },
  {
    slug: 'history', title: 'History and events', nav: 'History' ,
    intro: 'Sonata indexes and decodes every event and call from the contract\'s first ledger onward.',
    sections: [
      { h: 'Query', blocks: [
        { code: `GET /c/${SHORT}/events?type=transfer&address=GBX7…4Q9&from=2026-08-01&to=2026-09-09` },
        { kv: [
          { key: 'type', value: 'Event name', mono: false },
          { key: 'address', value: 'Any address in the decoded call', mono: false },
          { key: 'from / to', value: 'ISO dates or ledger numbers', mono: false },
          { key: 'format', value: 'json · csv', mono: false }
        ] }
      ] },
      { h: 'Record shape', blocks: [
        { code: `{
  "time": "2026-09-09T14:02:11Z",
  "event": "transfer",
  "call": "transfer(GBX7…4Q9, GCK2…M8P, 1,250 USDC)",
  "ledger": 48192044,
  "status": "success"
}` }
      ] }
    ]
  },
  {
    slug: 'llms', title: 'llms.txt', nav: 'llms.txt',
    intro: 'A compact Markdown document that describes the contract for language models and people.',
    sections: [
      { h: 'Example', blocks: [ { code: LLMS } ] },
      { h: 'Regeneration', blocks: [
        { p: 'Docs regenerate whenever the contract spec changes. You can also regenerate on demand from the Docs tab of a contract workspace and add your own notes.' }
      ] }
    ]
  }
];

export const DOC_BY_SLUG = Object.fromEntries(DOCS.map((d) => [d.slug, d]));
