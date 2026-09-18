# M3 — Real data + wallet ownership (design)

**Status:** approved in conversation on 2026-09-18 (Flows/Keys removed; wallet-signed ownership; wallet required to register; SEP-10-style challenge; Stellar Wallets Kit; Sign & submit in-app). Builds on M1 (`2026-09-17-sonata-server-core-engine-design.md`) and M2 (`2026-09-18-site-wiring-m2-design.md`).

## 1. Goal

After M3 the site shows **nothing invented**: every number, list, snippet and page comes from the API or is removed. A contract has an **owner** — the wallet that registered it — and only that wallet can rename it, change its MCP scope or re-run its pipeline. Anyone (humans, agents) can still read, simulate, build and submit. Writes become usable in the browser: the connected wallet signs the built XDR and the site submits it.

Non-goals: history/events (M4), SAC support (only a clear error), API keys, multiple owners, transferring ownership, per-user rate limits, in-app signing for MCP clients.

## 2. Ownership model

- `contracts.owner` (text, nullable) — the G… address that registered the contract. New rows always have an owner. Rows created before M3 have `owner = NULL` ("legacy").
- **Register** (`POST /contracts`) requires a session. If the id is new → row is created with `owner = caller`. If it exists and `owner = caller` → pipeline re-runs (refresh). If it exists and `owner = NULL` → caller becomes owner (one-time legacy claim, logged at `info`). If it exists and `owner ≠ caller` → `403 not_owner`.
- **Settings** (`PATCH /c/:id`: `name`, `mcp_scope`) require a session whose address equals `owner` (a legacy row is claimed the same way). Otherwise `401 unauthorized` (no/invalid token) or `403 not_owner`.
- **Everything else stays public and unchanged**: `GET /contracts`, `GET /c/:id`, `/status`, `/call`, `/tx`, `/submit`, `/tx/:hash`, `/llms.txt`, `/openapi.json`, MCP.
- `owner` is included in `GET /c/:id` and `GET /contracts` items (it is a public key the user chose to sign with; the site shows it truncated).
- `GET /contracts?owner=me` (session required) → only the caller's contracts. `GET /contracts` without the filter → all contracts (the public explorer). Items: `{ id, name, network, status, fns, owner, created_at, updated_at }`.

## 3. Authentication (server)

SEP-10-style challenge, implemented with the SDK's `WebAuth` helpers; the transaction is never submitted.

- `POST /auth/challenge` body `{ address: G…, network: 'testnet' | 'mainnet' }` → `200 { transaction: <base64 XDR>, network_passphrase }`.
  Built with `WebAuth.buildChallengeTx(serverKeypair, address, AUTH_HOME_DOMAIN, 300, passphrase, webAuthDomain)`. `webAuthDomain` = host of `PUBLIC_BASE_URL`. The `network` is whatever the user's wallet is currently on — the passphrase only affects the signature domain, nothing is sent to either network.
- `POST /auth/token` body `{ transaction: <signed base64 XDR>, network }` → `200 { token, address, expires_at }`.
  Verified with `WebAuth.readChallengeTx` (server signature, structure, time bounds) then `WebAuth.verifyChallengeTxSigners(tx, serverPub, passphrase, [clientAccountID], AUTH_HOME_DOMAIN, webAuthDomain)`; a challenge hash is accepted once (in-memory set, entries dropped after the 300 s window). Failures → `401 invalid_challenge` with a one-line reason.
- `GET /auth/me` (Bearer) → `200 { address, expires_at }`; `401 unauthorized` otherwise.
- Token: JWT HS256 (`jose`), claims `{ sub: address, iss: PUBLIC_BASE_URL, iat, exp = iat + 24h }`. Sent as `Authorization: Bearer <token>`. A missing/expired/invalid token on a protected route → `401 unauthorized` `{ error: 'unauthorized', message }`.
- **Keys are not env secrets.** On boot the server reads `settings` (new table `settings(key text pk, value text, created_at)`); if `auth_secret` (32 random bytes, base64) or `auth_signing_seed` (a `Keypair.random()` secret) is missing it generates and stores it. `AUTH_SECRET` / `AUTH_SIGNING_SEED` env vars override when set (tests use them). `AUTH_HOME_DOMAIN` env (default: host of the first `CORS_ORIGINS` entry, i.e. `sonata.brages.uk`).
- Rate limiting and CORS apply unchanged (`Authorization` is a CORS-safelisted request header only for simple requests; the CORS plugin must allow it — `allowedHeaders: ['content-type', 'authorization']`).

Fastify wiring: `src/auth/{keys.ts,jwt.ts,challenge.ts}` + `src/http/routes/auth.ts`; a `requireSession(req)` helper returns the address or throws 401; route handlers compare it with the row's `owner`.

## 4. Server hardening in scope

- **SAC contracts**: `RpcChain.getContractWasm` inspects the contract instance's executable; `contractExecutableStellarAsset` → `ChainError(400, 'sac_unsupported', 'Stellar Asset Contracts have no WASM spec; SAC support arrives in a later release')`. The pipeline records it as the `fetch` step's error and status `failed`; the site's pipeline view already shows step errors.
- `POST /contracts` for a mainnet id on a server without mainnet keeps returning `400 network_not_configured`.
- `GET /contracts` gains `owner` and `created_at`; `publicRow` gains `owner`.
- Migration `0001`: `ALTER TABLE contracts ADD COLUMN owner text; CREATE TABLE settings (...)`. `MemoryStore` mirrors both.

## 5. Site

### 5.1 Wallet + session
- `lib/wallet.js` (client-only; the kit is imported with dynamic `import()` inside functions so SSR never touches it): `connect()` → opens the Stellar Wallets Kit auth modal (modules: Freighter, xBull, Albedo, Lobstr, Hana; WalletConnect omitted — needs a project id) → `{ address }`; `getNetwork()` → `{ network, networkPassphrase }` from the kit (falls back to `testnet`); `signTransaction(xdr, networkPassphrase)` → signed XDR; `disconnect()`. Selected wallet id is remembered in `localStorage['sonata.wallet']`.
- `lib/auth.js`: `signIn()` = `connect()` → `POST /auth/challenge` → `signTransaction` → `POST /auth/token` → persist `{ token, address, expires_at }` in `localStorage['sonata.session']`; `signOut()` clears it and calls `wallet.disconnect()`; `getSession()`; expired sessions are dropped on read.
- `lib/api.js`: `api()` attaches `Authorization: Bearer` whenever a session exists; a `401` clears the session before throwing so the UI falls back to "connect". `contracts.list({ mine: true })` → `/contracts?owner=me`; `contracts.submit(id, xdr)` → `POST /c/:id/submit`; `auth.challenge/token/me`.
- `components/SessionProvider.jsx` (React context, mounted in `app/layout.jsx` inside the client tree): `{ session, address, status: 'anonymous' | 'signing' | 'ready', signIn, signOut, error }`.
- `components/WalletButton.jsx` in the nav's `nav-right`: anonymous → "Connect wallet"; signing → "Waiting for wallet…"; ready → `GABC…WXYZ` with a small menu (My contracts · Disconnect). Errors (user rejected, wrong network, no wallet installed) show as a one-line note under the button for a few seconds.

### 5.2 Screens
- **Home** (`/`): real hero copy ("REST endpoints, an MCP server and AI-ready docs for any Soroban contract"); CTAs "Register a contract" (→ `/register`) and "Browse contracts" (→ `/explorer`); hero rows = three real surfaces (REST · MCP · Docs). Stats row from `GET /contracts`: contracts registered · functions exposed (sum of `fns` over ready rows) · networks live (from `/healthz`) · MCP tools (sum of `fns + 2`). The code samples use the most recently updated **ready** contract from the list (curl `/call/<first read fn>` and the MCP config for it); with no contracts they show `{contractId}` placeholders. No preview bar.
- **Explorer** (`/explorer`): real list from `GET /contracts` (ready rows only), network chips All/Testnet/Mainnet, search by name or id, sort "Recently updated" / "Name". Card: name or short id, network chip, `fns` functions, owner truncated, updated relTime. Empty → "No contracts registered yet" + register CTA. Categories, verified badges and call counts are removed.
- **Public contract page** (`/explorer/[id]`): `Demo` fallback and `PUBLIC_FNS` removed; unknown id → `NotRegistered` panel. `generateMetadata` uses the live row only. Kind chip shows Read / Write / **Unknown**.
- **Register**: needs a session. Anonymous → the primary button reads "Connect wallet to register" and runs `signIn()` then continues. `403 not_owner` → "This contract was registered by another wallet (GABC…WXYZ)." `400 sac_unsupported` surfaces as the pipeline error.
- **My contracts** (`/contracts`): `contracts.list({ mine: true })`; anonymous → panel "Connect your wallet to see the contracts you registered" with a connect button and a link to the explorer.
- **Workspace** (`/c/[id]/[tab]`): public. Owner-only controls — Rename, MCP scope Segmented — render only when `session.address === contract.owner`; others see an "Owned by GABC…WXYZ" chip and the scope as text. Overview: the History surface row says "coming soon" (chip `soon`) and links to the History tab. **History tab**: no preview bar, no fake rows — an empty state: "History isn't live yet. Decoded events and calls arrive with a history provider in a later release." with a link to `/docs/api`. Functions tab: kind label **Unknown** (hint "classified on first simulation"); in build mode, when a session exists the `source` field is prefilled with the session address and a **Sign & submit** button appears next to "Build unsigned XDR": it builds, calls `wallet.signTransaction(xdr, passphrase(contract.network))`, `POST /c/:id/submit`, and shows `{ hash, status, ledger }` (or the error envelope). Wallet on the wrong network → a note "Switch your wallet to <network>". `Download XDR` stays for external signing.
- **Docs**: rewritten to the real product — Overview (what you get, ownership, history coming), Quickstart (connect · register · call · build · sign & submit), REST API (all endpoints incl. `/auth/*`, request/response shapes, error envelope, 120 req/min, networks), MCP (tools, scope, one-liner), llms.txt (a real excerpt of the e2e fixture's generated `llms.txt`). The History page and every mention of `/events`, `/flows/*/build` and API keys are removed.
- **Deleted**: `app/flows/**`, `app/keys/**`, `components/screens/{Flows,FlowDetail,Keys}.jsx`, `components/{flows-data,explorer-data,home-data}.js`, `components/PreviewBar.jsx`, the sample exports in `components/data.js` (`DEMO_API_URL, CONTRACT_ID, MCP_URL, XDR, MCP_CONFIG, LLMS, EV, ADDR_EV, EV_COLS, ADDR_COLS, HIST_OPTS, WELCOME_ROWS`). `data.js` keeps `SITE_URL, TAB_LABEL, NET_OPTS`. Nav: Explorer · Contracts · Docs (+ wallet button); footer: Explorer · Docs · Quickstart · REST API · MCP · Contracts. `seo.js` description drops "fully indexed on-chain history". README routes/notes updated.

## 6. Error handling

- Server: new codes `unauthorized` (401), `not_owner` (403, `details: { owner }`), `invalid_challenge` (401), `sac_unsupported` (400). Everything else keeps the M1 envelope.
- Site: `ApiError(401)` → session cleared → UI shows the connect state; `403 not_owner` → inline message naming the owner; wallet errors are shown where the action was started and never leave the page in a half state (build result stays visible if signing is rejected).

## 7. Testing

- Server unit (vitest, MemoryStore + FakeChain): auth keys generated/persisted; challenge → sign with a random `Keypair` → token → `/auth/me`; wrong signer / tampered / expired challenge → 401; replayed challenge → 401; `POST /contracts` without token → 401; owner-based 403 on register and PATCH; legacy claim; `?owner=me`; `owner` in list/get; SAC → `sac_unsupported` and a `failed` pipeline; CORS allows `authorization`.
- Server e2e (`test/e2e/flow.test.ts`): registers with a token obtained by signing the challenge with `E2E_SECRET_KEY`.
- Site unit (vitest/jsdom): `lib/auth` (persist/expire/clear on 401), `lib/api` attaches the header, `lib/wallet` against a fake kit (network fallback, sign passthrough), `WalletButton` states, `Functions` shows Sign & submit only with a session, `History` empty state, `Explorer` filtering on API shapes.
- Playwright (`e2e/site.spec.ts`, local/manual as before): obtains a real token by signing the challenge with `E2E_SECRET_KEY` inside the test, injects `sonata.session` into `localStorage`, then: register → workspace shows owner controls → rename → scope toggle → simulate → build (Sign & submit button visible; not clicked — no wallet extension in CI) → docs → explorer list shows the contract → public page. Anonymous visit: controls hidden, "Owned by" chip visible, register button reads "Connect wallet to register".

## 8. Deployment notes

- Server: run the migration on boot (already automatic); no new env required on Dokploy (keys self-generate into `settings`); optionally `AUTH_HOME_DOMAIN`. The four contracts registered before M3 are legacy rows — the user's wallet claims them by re-registering (or they stay ownerless until then).
- Site: `npm i @creit-tech/stellar-wallets-kit`; no new env. The kit is ~200 KB and only loads on the client when a wallet action starts.
