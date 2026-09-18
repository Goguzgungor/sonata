import { API_URL } from '@/lib/api';

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
        { p: "History (decoded events and calls) is not live yet; it arrives with a history provider in a later release." }
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
{ "error": "not_owner", "message": "this contract was registered by another wallet", "code": 403, "details": { "owner": "G…" } }` }
      ] },
      { h: 'Authentication and limits', blocks: [
        { p: 'Registering a contract or changing its settings needs a session: sign a SEP-10-style challenge with your wallet to get a bearer token valid for 24 hours. Reads, simulation, transaction building and submission need no session. The API allows 120 requests per minute per IP. Stellar Asset Contracts (SACs) are not supported and return sac_unsupported.' }
      ] }
    ]
  },
  {
    slug: 'mcp', title: 'MCP server', nav: 'MCP server',
    intro: 'Give Claude, Cursor or Codex contract-level tools without writing a single wrapper.',
    sections: [
      { h: 'Connect', blocks: [
        { p: 'Every contract exposes its own MCP endpoint over HTTP. Paste the config into your client or run the one-liner.' },
        { code: `{
  "mcpServers": {
    "sonata-<name>": {
      "url": "${API_URL}/c/{contractId}/mcp",
      "type": "http"
    }
  }
}

claude mcp add --transport http sonata-<name> ${API_URL}/c/{contractId}/mcp` }
      ] },
      { h: 'Tools', blocks: [
        { kv: [
          { key: 'search_functions', value: 'Find functions by name or purpose', mono: false },
          { key: 'get_docs', value: 'Return llms.txt for the contract', mono: false },
          { key: 'call_{fn}', value: 'Simulate a function', mono: false },
          { key: 'build_{fn}', value: 'Build unsigned XDR for a function (read + write scope)', mono: false },
          { key: 'submit_transaction', value: 'Submit a signed transaction (read + write scope)', mono: false }
        ] },
        { p: 'Write tools (build_{fn} and submit_transaction) stay disabled until the owner switches the contract’s MCP scope to read + write in the workspace. Agents never hold keys: they receive unsigned XDR and hand it to a signer.' }
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
