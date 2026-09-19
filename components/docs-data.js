import { API_URL, mcpGlobalConfig, mcpGlobalOneLiner } from '@/lib/api';

/* Each doc page: slug, title, intro, sections[]. Blocks: p | code | list | kv */
export const DOCS = [
  {
    slug: 'overview', title: 'Overview', nav: 'Overview',
    intro: 'Sonata turns any Soroban contract into a hosted API, an MCP server and AI-ready docs. Nothing to deploy, no SDK, no custody.',
    sections: [
      { h: 'What you get', blocks: [
        { list: [
          'A REST API for every function in the contract: simulate reads, build unsigned XDR for writes, and submit signed transactions.',
          'An MCP server per contract, so Claude, Cursor and Codex can read, simulate and build transactions.',
          'llms.txt and an OpenAPI 3.1 document generated from the contract spec.'
        ] }
      ] },
      { h: 'How it fits together', blocks: [
        { p: 'You register a contract once. Sonata reads its spec and publishes the surfaces above under a single base URL.' },
        { kv: [
          { key: 'Base URL', value: API_URL },
          { key: 'Contract path', value: '/c/{contractId}' },
          { key: 'Networks', value: 'testnet · mainnet', mono: false },
          { key: 'Auth', value: 'Reads are public; registering and settings need a wallet session', mono: false }
        ] }
      ] },
      { h: 'Ownership', blocks: [
        { p: 'The wallet that registers a contract owns it: only the owner can rename it, change its MCP scope or refresh it. Anyone can read a contract, simulate its functions, build transactions and submit signed ones.' }
      ] },
      { h: 'History', blocks: [
        { p: "GET /c/{contractId}/events reads decoded contract events straight from the network's RPC — nothing is indexed or stored, so the window covers roughly the last 7 days." }
      ] }
    ]
  },
  {
    slug: 'quickstart', title: 'Quickstart', nav: 'Quickstart',
    intro: 'From a contract ID to a working call in about thirty seconds.',
    sections: [
      { h: '1. Connect a wallet', blocks: [
        { p: 'Connect a Freighter, xBull, Albedo or Lobstr wallet from the nav. This opens a session used to register contracts and change their settings.' }
      ] },
      { h: '2. Register', blocks: [
        { p: 'Paste a contract ID, pick a network and choose Generate. Sonata reads the contract spec and publishes the REST API, MCP server and docs for it.' }
      ] },
      { h: '3. Read', blocks: [
        { code: `curl -X POST "${API_URL}/c/{contractId}/call/{fn}" \\
  -H "Content-Type: application/json" \\
  -d '{ "args": { … } }'

# -> { "result": …, "simulated": true, "latency_ms": 42, "ledger": 123, "auth": [] }` }
      ] },
      { h: '4. Write', blocks: [
        { p: 'Build an unsigned transaction with /tx/{fn}, then sign it with the connected wallet using Sign & submit, or sign it with any Stellar signer and submit it yourself.' },
        { code: `curl -X POST "${API_URL}/c/{contractId}/tx/{fn}" \\
  -H "Content-Type: application/json" \\
  -d '{ "args": …, "source": "G…" }'

# -> { "xdr": "AAAAAgAAAADzKF2C…", "fee": "100", "auth": […], "ledger": 123, "expires_at": "2026-09-18T14:32:00Z" }

curl -X POST "${API_URL}/c/{contractId}/submit" \\
  -H "Content-Type: application/json" \\
  -d '{ "xdr": "AAAAAgAAAADzKF2C…" }'` }
      ] }
    ]
  },
  {
    slug: 'api', title: 'REST API', nav: 'REST API',
    intro: 'Every contract function becomes an HTTP endpoint. Reads are simulated; writes return unsigned XDR for you to sign.',
    sections: [
      { h: 'Endpoints', blocks: [
        { kv: [
          { key: 'POST /auth/challenge', value: '{address, network} → a SEP-10-style challenge to sign', mono: false },
          { key: 'POST /auth/token', value: '{transaction, network} → {token, address, expires_at}', mono: false },
          { key: 'GET /auth/me', value: 'The current session', mono: false },
          { key: 'POST /contracts', value: 'Register a contract (session required; caller becomes owner)', mono: false },
          { key: 'GET /contracts', value: 'List contracts; add ?owner=me for the caller’s own (session required)', mono: false },
          { key: 'GET /c/{id}', value: 'Contract summary and spec', mono: false },
          { key: 'GET /c/{id}/status', value: 'Registration pipeline status', mono: false },
          { key: 'PATCH /c/{id}', value: 'Rename or change MCP scope (owner only)', mono: false },
          { key: 'POST /c/{id}/call/{fn}', value: 'Simulate a function', mono: false },
          { key: 'POST /c/{id}/tx/{fn}', value: 'Build unsigned XDR for a function', mono: false },
          { key: 'POST /c/{id}/submit', value: 'Submit a signed transaction', mono: false },
          { key: 'GET /c/{id}/events', value: '?type&address&from&to&cursor&limit&format → decoded events from the last ~7 days; format=csv for a CSV download', mono: false },
          { key: 'GET /tx/{hash}?network=', value: 'Look up a submitted transaction', mono: false },
          { key: 'GET /c/{id}/llms.txt', value: 'AI-ready docs', mono: false },
          { key: 'GET /c/{id}/openapi.json', value: 'OpenAPI 3.1 document', mono: false },
          { key: 'GET /healthz', value: 'Service health', mono: false }
        ] }
      ] },
      { h: 'Request body', blocks: [
        { p: 'Arguments are passed by name in "args" and encoded from the contract spec. Integers of 64 bits or wider are decimal strings, bytes are 0x-hex, maps are plain objects, enums are integers, and unions are either the case name as a string or {tag, values}.' },
        { code: `{
  "args": { "from": "G…", "to": "G…", "amount": "1250000000" },
  "source": "G…"
}` }
      ] },
      { h: 'Responses', blocks: [
        { code: `// read (POST /c/{id}/call/{fn})
{ "result": { "balance": "1250000000" }, "simulated": true, "latency_ms": 42, "ledger": 123, "auth": [] }

// write (POST /c/{id}/tx/{fn})
{ "xdr": "AAAAAgAAAADzKF2C…", "fee": "100", "auth": ["from"], "ledger": 123, "expires_at": "2026-09-18T14:32:00Z" }

// error
{ "error": "not_owner", "message": "this contract was registered by another wallet", "details": { "owner": "G…" } }

// error, contract-raised (code is the contract's own error number)
{ "error": "TooBig", "message": "The number was too big.", "code": 1, "details": { "fn": "checked" } }` }
      ] },
      { h: 'Authentication and limits', blocks: [
        { p: 'Registering a contract or changing its settings needs a session: sign a SEP-10-style challenge with your wallet to get a bearer token valid for 24 hours. Reads, simulation, transaction building and submission need no session. The API allows 120 requests per minute per IP. Stellar Asset Contracts (XLM, USDC, …) are supported through the built-in token interface.' }
      ] },
      { h: 'Event history', blocks: [
        { p: 'GET /c/{id}/events decodes contract events on demand from the network’s RPC — nothing is indexed or stored, so the window covers roughly the last 7 days. type matches a declared event name (e.g. Pinged) or the raw on-chain symbol; from and to accept a ledger sequence or an ISO-8601 time and are clamped to the retention window; address post-filters the fetched page for a G… or C… address appearing anywhere in an event’s topics or data; a range entirely outside the window returns range_out_of_retention. format=csv returns the same rows as text/csv instead of JSON.' }
      ] }
    ]
  },
  {
    slug: 'mcp', title: 'MCP server', nav: 'MCP server',
    intro: 'One endpoint for every registered contract.',
    sections: [
      { h: 'Connect', blocks: [
        { p: 'One global MCP server over Streamable HTTP covers every registered contract, on any network. Paste the config into your client or run the one-liner.' },
        { code: `${mcpGlobalConfig}

${mcpGlobalOneLiner}` }
      ] },
      { h: 'Workflow', blocks: [
        { p: 'list_contracts to find a contract → get_contract for its function list and argument schemas → call to simulate or build to get unsigned XDR → the user’s wallet signs → submit the signed transaction.' }
      ] },
      { h: 'Tools', blocks: [
        { kv: [
          { key: 'list_contracts', value: '{ network?, q?, include_pending? } → ready contracts by default, newest updated first, capped at 200', mono: false },
          { key: 'get_contract', value: '{ id } → functions with JSON schemas, types, errors, events, mcp_scope, owner, urls', mono: false },
          { key: 'search_functions', value: '{ id, query } → matching functions by name or purpose', mono: false },
          { key: 'get_docs', value: '{ id } → llms.txt for the contract', mono: false },
          { key: 'get_events', value: '{ id, type?, address?, from?, to?, cursor?, limit? } → decoded events (last ~7 days)', mono: false },
          { key: 'call', value: '{ id, fn, args?, source? } → simulate any function, read or write', mono: false },
          { key: 'build', value: '{ id, fn, args?, source, fee?, timeout_s? } → unsigned XDR for the user’s wallet to sign', mono: false },
          { key: 'submit', value: '{ id, xdr } → submit a signed transaction, wait up to 30 s. id selects the network and the write gate; the envelope itself is any signed transaction on that network.', mono: false },
          { key: 'get_tx', value: '{ hash, network } → poll a submitted transaction', mono: false }
        ] },
        { p: 'build and submit only work for a contract whose owner has switched its MCP scope to read + write; every other tool works regardless of scope. Agents never hold keys: they receive unsigned XDR and hand it to a signer.' }
      ] },
      { h: 'Scoped endpoints', blocks: [
        { p: `Each registered contract also exposes its own scoped MCP server, narrowed to just that contract's tools (search_functions, get_docs, get_events, call_{fn}, and build_{fn} / submit_transaction once the owner enables read + write): claude mcp add --transport http sonata-<name> ${API_URL}/c/{contractId}/mcp` }
      ] }
    ]
  },
  {
    slug: 'llms', title: 'llms.txt', nav: 'llms.txt',
    intro: 'A compact Markdown document that describes the contract for language models and people.',
    sections: [
      { h: 'Example', blocks: [ { code: `# e2e fixture

Soroban contract · 15 functions · SEP-48 · testnet
Contract ID: CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP

## Endpoints

Base: https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP
POST https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/call/{fn}   simulate any function → { result, simulated: true, auth }
POST https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/tx/{fn}     build unsigned XDR → { xdr, fee, auth }
POST https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/submit      relay a signed XDR → { hash, status }
GET  https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/openapi.json
MCP: https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/mcp (Streamable HTTP)

Arguments are passed by name in \`args\`. Integers ≥ 64-bit are decimal strings, bytes are 0x-hex, maps are objects keyed by the map key, enums are integers, unions are "Name" for a void case or {tag, values} otherwise, tuples are arrays, and an Option is the value or null.

\`\`\`
curl -X POST "https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/call/add" -H "Content-Type: application/json" -d '{"args":{"a":"0","b":"0"}}'
\`\`\`

## Functions

add(a: i128, b: i128) → i128
  Returns the sum of two i128 values.
bump() → u32` } ] },
      { h: 'Regeneration', blocks: [
        { p: 'Docs regenerate on every registration and rename.' }
      ] }
    ]
  }
];

export const DOC_BY_SLUG = Object.fromEntries(DOCS.map((d) => [d.slug, d]));
