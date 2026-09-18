# M3 — Real data + wallet ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every invented number/list/page from the site, add wallet-signed ownership (SEP-10-style challenge → JWT) to the API, and let the connected wallet sign & submit built transactions in the browser.

**Architecture:** Server gains an `auth` module (keys self-generated into a `settings` table, `WebAuth` challenge, HS256 JWT via `jose`) and an `owner` column; register/PATCH require a session and compare the address with `owner`; reads stay public. Site gains `lib/wallet.js` (Stellar Wallets Kit, dynamic import), `lib/session.js` + `lib/auth.js`, a `SessionProvider`, a nav `WalletButton`, owner-gated controls in the workspace and a Sign & submit flow; Home/Explorer/public page read `/contracts`; Flows, Keys, sample-data modules and the preview bar are deleted; History is an empty state; docs are rewritten to the real API.

**Tech Stack:** Server: Node 22, TypeScript, Fastify 5, drizzle-orm 0.45 + drizzle-kit, zod 4, `@stellar/stellar-sdk` 17 (`WebAuth`), `jose` ^6, vitest 5. Site: Next.js 15 App Router (JS/JSX only, no TypeScript), React 19, `@creit.tech/stellar-wallets-kit` ^2.6, vitest 5 + @testing-library/react (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-m3-real-data-ownership-design.md` (read it first; it is the authority for every shape below).

## Global Constraints

- Server code is TypeScript under `server/src`; tests under `server/test/**/*.test.ts` (vitest, `npm test` in `server/`, e2e excluded). Site code is JavaScript/JSX; site unit tests live in `test/site/**/*.test.{js,jsx}` (vitest + jsdom, `npm test` at the repo root). Never add TypeScript to the site.
- Error envelope everywhere: `{ error, message, code?, details? }`. New codes (exact strings): `unauthorized` (401), `not_owner` (403, `details: { owner }`), `invalid_challenge` (401), `sac_unsupported` (400).
- Session token: HS256 JWT, `sub` = G address, `iss` = `PUBLIC_BASE_URL`, 24 h lifetime; header `Authorization: Bearer <token>`.
- Challenge: `WebAuth.buildChallengeTx(serverKeypair, address, AUTH_HOME_DOMAIN, 300, passphrase, webAuthDomain)`; `webAuthDomain` = host of `PUBLIC_BASE_URL`; passphrases are `PASSPHRASES[network]` from `server/src/config.ts`; a challenge hash is accepted once.
- Ownership: `contracts.owner` nullable text. Register: new → owner = caller; same owner → re-run; `owner = NULL` → caller claims; other owner → `403 not_owner`. PATCH: same rules. Reads, `/call`, `/tx`, `/submit`, `/tx/:hash`, docs, MCP stay public.
- `GET /contracts` items: `{ id, name, network, status, fns, owner, created_at, updated_at }`; `?owner=me` requires a session and filters to the caller.
- Wallet kit package name is `@creit.tech/stellar-wallets-kit` (dotted scope); import only from `@creit.tech/stellar-wallets-kit/sdk` and `@creit.tech/stellar-wallets-kit/modules/{freighter,xbull,albedo,lobstr}`; always via dynamic `import()` inside a function (never at module top level).
- localStorage keys: `sonata.session` (`{ token, address, expires_at }`), `sonata.wallet` (selected wallet id).
- Function kind label in the UI for `unknown`: the word `Unknown`.
- History tab copy (exact): "History isn't live yet." / "Decoded events and calls arrive with a history provider in a later release."
- Every task ends with `git commit`; never commit `.env`, `.env.test`, tokens or seeds. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Deployment: server autodeploys from `main` when `server/**` changes (Dokploy); the site is deployed with `vercel deploy --prod --yes` from the repo root. Production URLs: API `https://api.sonata.brages.uk`, site `https://sonata.brages.uk`. Testnet e2e fixture `CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP`; its funded secret lives only in git-ignored `server/.env.test` (`E2E_SECRET_KEY`).

---

## File structure

Server (create): `src/auth/keys.ts` (secret + signing keypair from `settings`/env), `src/auth/jwt.ts` (issue/verify), `src/auth/challenge.ts` (build + verify + replay set), `src/http/session.ts` (`sessionOf`, `requireSession`), `src/http/routes/auth.ts` (`/auth/*`), `drizzle/0001_*.sql` (+ meta), `test/auth/{keys,jwt,challenge}.test.ts`, `test/http/auth.test.ts`, `test/helpers/session.ts`, `test/registry/owner.test.ts`.
Server (modify): `src/registry/schema.ts`, `src/registry/store.ts`, `src/registry/registry.ts`, `src/http/deps.ts`, `src/http/app.ts`, `src/http/routes/contracts.ts`, `src/config.ts`, `src/main.ts`, `src/chain/errors.ts`, `src/chain/rpc.ts`, `test/helpers/app.ts`, `test/http/contracts.test.ts`, `test/chain/rpc.test.ts`, `test/e2e/flow.test.ts`, `.env.example`, `README.md`.
Site (create): `lib/session.js`, `lib/auth.js`, `lib/wallet.js`, `components/SessionProvider.jsx`, `components/WalletButton.jsx`, `test/site/{session,wallet,auth}.test.js`, `test/site/{wallet-button,functions-sign,history,explorer}.test.jsx`.
Site (modify): `lib/api.js`, `app/layout.jsx`, `components/TopNav.jsx`, `components/SiteFooter.jsx`, `components/data.js`, `components/seo.js`, `components/screens/{Register,Contracts,Explorer,ContractPublic,Welcome}.jsx`, `components/workspace/{Workspace,Overview,History,Functions,Mcp}.jsx`, `components/docs-data.js`, `app/explorer/[id]/page.jsx`, `README.md`, `playwright.config.js`, `e2e/site.spec.ts`, `package.json`.
Site (delete): `app/flows/**`, `app/keys/**`, `components/screens/{Flows,FlowDetail,Keys}.jsx`, `components/{flows-data,explorer-data,home-data}.js`, `components/PreviewBar.jsx`.

---

### Task 1: `owner` column, `settings` table, store support

**Files:**
- Modify: `server/src/registry/schema.ts`, `server/src/registry/store.ts`, `server/src/registry/registry.ts:36-47`
- Create: `server/drizzle/0001_owner_settings.sql` (+ `drizzle/meta` via drizzle-kit), `server/test/registry/owner.test.ts`

**Interfaces:**
- Produces: `ContractRow.owner: string | null`; `Store.list(filter?: { owner?: string })`; `Store.upsertQueued(id, network, name, owner: string | null)`; `Store.getSetting(key): Promise<string | null>`; `Store.setSetting(key, value): Promise<void>`; `Registry.register(id, network, name = null, owner: string | null = null)`.

- [ ] **Step 1: Write the failing store test**

Create `server/test/registry/owner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../../src/registry/store.js';
import { FIXTURE_ID } from '../fixtures/index.js';

const A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const OTHER = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

describe('owner column', () => {
  it('upsertQueued stores the owner and never overwrites an existing one', async () => {
    const s = new MemoryStore();
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', 'KS', A)).owner).toBe(A);
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', null, B)).owner).toBe(A);   // route layer rejects B before this; the store is defensive too
  });
  it('a legacy row (owner null) takes the first owner offered', async () => {
    const s = new MemoryStore();
    await s.upsertQueued(FIXTURE_ID, 'testnet', null, null);
    expect((await s.get(FIXTURE_ID))!.owner).toBeNull();
    expect((await s.upsertQueued(FIXTURE_ID, 'testnet', null, B)).owner).toBe(B);
  });
  it('list filters by owner', async () => {
    const s = new MemoryStore();
    await s.upsertQueued(FIXTURE_ID, 'testnet', null, A);
    await s.upsertQueued(OTHER, 'mainnet', null, B);
    expect((await s.list()).map((r) => r.id).sort()).toEqual([FIXTURE_ID, OTHER].sort());
    expect((await s.list({ owner: A })).map((r) => r.id)).toEqual([FIXTURE_ID]);
    expect(await s.list({ owner: 'GNOBODY' })).toEqual([]);
  });
  it('settings round-trip', async () => {
    const s = new MemoryStore();
    expect(await s.getSetting('auth_secret')).toBeNull();
    await s.setSetting('auth_secret', 'abc');
    expect(await s.getSetting('auth_secret')).toBe('abc');
    await s.setSetting('auth_secret', 'def');
    expect(await s.getSetting('auth_secret')).toBe('def');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd server && npx vitest run test/registry/owner.test.ts`
Expected: FAIL — `upsertQueued` ignores the 4th argument / `getSetting` is not a function.

- [ ] **Step 3: Schema**

Replace `server/src/registry/schema.ts` with:

```ts
import { pgTable, text, bigint, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  network: text('network').notNull(),
  name: text('name'),
  /** G… address that registered the contract; NULL only for rows created before M3 (legacy, claimable). */
  owner: text('owner'),
  wasmHash: text('wasm_hash'),
  specLedger: bigint('spec_ledger', { mode: 'number' }),
  specXdr: text('spec_xdr').array(),
  model: jsonb('model'),
  llmsTxt: text('llms_txt'),
  openapi: jsonb('openapi'),
  mcpScope: text('mcp_scope').notNull().default('ro'),
  status: text('status').notNull().default('queued'),
  steps: jsonb('steps').notNull().default([]),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const fnHints = pgTable('fn_hints', {
  contractId: text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  fn: text('fn').notNull(),
  kind: text('kind').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.contractId, t.fn] })]);

/** Server-generated secrets (JWT secret, challenge signing seed) so production needs no secret env vars. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
```

- [ ] **Step 4: Migration**

Run: `cd server && npx drizzle-kit generate --name owner_settings`
Expected: `drizzle/0001_owner_settings.sql` plus an updated `drizzle/meta/_journal.json` and `drizzle/meta/0001_snapshot.json`. The SQL must be exactly these statements (if drizzle-kit is unavailable, write the file by hand and add the journal entry `{ "idx": 1, "version": "7", "when": <epoch ms>, "tag": "0001_owner_settings", "breakpoints": true }`):

```sql
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "owner" text;
```

- [ ] **Step 5: Store**

In `server/src/registry/store.ts`:

1. Import `settings` alongside `contracts, fnHints`.
2. `ContractRow`: add `owner: string | null;` right after `name: string | null;`.
3. `Store` interface: replace `list()` and `upsertQueued(...)` and add two methods:

```ts
  list(filter?: { owner?: string }): Promise<ContractRow[]>;
  /** Creates or re-queues a row. `owner` is stored on create and fills a NULL (legacy) owner; it never replaces an existing owner. */
  upsertQueued(id: string, network: Network, name: string | null, owner: string | null): Promise<ContractRow>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
```

4. `MemoryStore`: add `private settings = new Map<string, string>();` and clear it in `clear()`; replace `list` and `upsertQueued`:

```ts
  async list(filter: { owner?: string } = {}) {
    return [...this.rows.values()].filter((r) => filter.owner === undefined || r.owner === filter.owner)
      .map((r) => structuredClone(r)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async upsertQueued(id: string, network: Network, name: string | null, owner: string | null) {
    const now = new Date();
    const existing = this.rows.get(id);
    const row: ContractRow = existing ? { ...existing, name: name ?? existing.name, owner: existing.owner ?? owner, status: 'queued', steps: [], error: null, updatedAt: now }
      : { id, network, name, owner, wasmHash: null, specLedger: null, specXdr: null, model: null, llmsTxt: null, openapi: null, mcpScope: 'ro', status: 'queued', steps: [], error: null, createdAt: now, updatedAt: now };
    this.rows.set(id, row); return structuredClone(row);
  }
  async getSetting(key: string) { return this.settings.get(key) ?? null; }
  async setSetting(key: string, value: string) { this.settings.set(key, value); }
```

5. `toRow`: add `owner: r.owner,` after `name: r.name,`.
6. `PgStore`: replace `list` and `upsertQueued`, add the settings methods:

```ts
  async list(filter: { owner?: string } = {}) {
    const q = this.db.select().from(contracts);
    const rows = filter.owner === undefined ? await q.orderBy(sql`${contracts.updatedAt} desc`) : await q.where(eq(contracts.owner, filter.owner)).orderBy(sql`${contracts.updatedAt} desc`);
    return rows.map(toRow);
  }
  async upsertQueued(id: string, network: Network, name: string | null, owner: string | null) {
    const [r] = await this.db.insert(contracts).values({ id, network, name, owner, status: 'queued', steps: [] })
      .onConflictDoUpdate({ target: contracts.id, set: { name: sql`coalesce(${name}, ${contracts.name})`, owner: sql`coalesce(${contracts.owner}, ${owner})`, status: 'queued', steps: [], error: null, updatedAt: sql`now()` } })
      .returning();
    return toRow(r);
  }
  async getSetting(key: string) { const [r] = await this.db.select().from(settings).where(eq(settings.key, key)); return r ? r.value : null; }
  async setSetting(key: string, value: string) {
    await this.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  }
```

7. `server/src/registry/registry.ts` `register`: change the signature to `async register(id: string, network: Network, name: string | null = null, owner: string | null = null): Promise<ContractRow>` and the store call to `this.deps.store.upsertQueued(id, network, name, owner)`.

- [ ] **Step 6: Run the new test and the whole suite**

Run: `cd server && npm test`
Expected: `owner.test.ts` PASS; `store.test.ts` PgStore cases are skipped or pass depending on `TEST_DATABASE_URL` (unchanged behaviour); every other test still passes. `npm run typecheck` is clean. (The existing `store.test.ts` calls `upsertQueued(ID, 'testnet', 'Kitchen')` with 3 args — add a 4th `null` argument to every such call in that file.)

- [ ] **Step 7: Commit**

```bash
git add server/src/registry server/drizzle server/test/registry
git commit -m "server: owner column, settings table, owner-aware store" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: auth modules — keys, JWT, challenge

**Files:**
- Create: `server/src/auth/keys.ts`, `server/src/auth/jwt.ts`, `server/src/auth/challenge.ts`, `server/test/auth/keys.test.ts`, `server/test/auth/jwt.test.ts`, `server/test/auth/challenge.test.ts`
- Modify: `server/package.json` (add `jose`)

**Interfaces:**
- Consumes: `Store.getSetting/setSetting` (Task 1); `PASSPHRASES` from `src/config.ts`; `ApiError` from `src/errors.ts`.
- Produces: `loadAuthKeys(store, env): Promise<AuthKeys>` with `AuthKeys = { secret: Uint8Array; signing: Keypair }`; `issueToken(secret, issuer, address, now?)`, `verifyToken(secret, issuer, token)`; `buildChallenge(deps, address, network)`, `class ChallengeVerifier { verify(signedXdr, network, now?): string }`, `type ChallengeDeps = { signing: Keypair; homeDomain: string; webAuthDomain: string }`.

- [ ] **Step 1: Install jose**

Run: `cd server && npm i jose@^6`
Expected: `jose` appears in `dependencies`.

- [ ] **Step 2: Failing tests**

`server/test/auth/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { MemoryStore } from '../../src/registry/store.js';
import { loadAuthKeys } from '../../src/auth/keys.js';

describe('loadAuthKeys', () => {
  it('generates a secret and a signing seed once and persists them in settings', async () => {
    const store = new MemoryStore();
    const a = await loadAuthKeys(store, {});
    expect(a.secret).toHaveLength(32);
    expect(a.signing.publicKey()).toMatch(/^G/);
    expect(await store.getSetting('auth_secret')).toBe(Buffer.from(a.secret).toString('base64'));
    expect(await store.getSetting('auth_signing_seed')).toBe(a.signing.secret());
    const b = await loadAuthKeys(store, {});
    expect(Buffer.from(b.secret).equals(Buffer.from(a.secret))).toBe(true);
    expect(b.signing.publicKey()).toBe(a.signing.publicKey());
  });
  it('env overrides win and are not written back', async () => {
    const store = new MemoryStore();
    const kp = Keypair.random();
    const secret = Buffer.alloc(32, 7).toString('base64');
    const a = await loadAuthKeys(store, { AUTH_SECRET: secret, AUTH_SIGNING_SEED: kp.secret() });
    expect(Buffer.from(a.secret).equals(Buffer.alloc(32, 7))).toBe(true);
    expect(a.signing.publicKey()).toBe(kp.publicKey());
    expect(await store.getSetting('auth_secret')).toBeNull();
  });
});
```

`server/test/auth/jwt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { issueToken, verifyToken, SESSION_TTL_S } from '../../src/auth/jwt.js';

const secret = new Uint8Array(32).fill(9);
const other = new Uint8Array(32).fill(1);
const ISS = 'https://api.sonata.test';
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('session tokens', () => {
  it('issues a 24h HS256 token and verifies it', async () => {
    const now = Date.parse('2026-09-18T12:00:00Z');
    const { token, expiresAt } = await issueToken(secret, ISS, G, now);
    expect(expiresAt).toBe(new Date(now + SESSION_TTL_S * 1000).toISOString());
    expect(await verifyToken(secret, ISS, token)).toEqual({ address: G, expiresAt });
  });
  it('rejects a wrong secret, a wrong issuer, garbage and an expired token', async () => {
    const { token } = await issueToken(secret, ISS, G);
    expect(await verifyToken(other, ISS, token)).toBeNull();
    expect(await verifyToken(secret, 'https://elsewhere', token)).toBeNull();
    expect(await verifyToken(secret, ISS, 'not.a.jwt')).toBeNull();
    const { token: old } = await issueToken(secret, ISS, G, Date.now() - (SESSION_TTL_S + 60) * 1000);
    expect(await verifyToken(secret, ISS, old)).toBeNull();
  });
});
```

`server/test/auth/challenge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { PASSPHRASES } from '../../src/config.js';
import { buildChallenge, ChallengeVerifier, type ChallengeDeps } from '../../src/auth/challenge.js';

const deps: ChallengeDeps = { signing: Keypair.random(), homeDomain: 'sonata.test', webAuthDomain: 'api.sonata.test' };
const client = Keypair.random();
const sign = (xdr: string, kp: Keypair, network: 'testnet' | 'mainnet' = 'testnet') => { const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASES[network]); tx.sign(kp); return tx.toXDR(); };

describe('challenge', () => {
  it('builds a server-signed challenge for the address on the requested network', () => {
    const c = buildChallenge(deps, client.publicKey(), 'mainnet');
    expect(c.networkPassphrase).toBe(PASSPHRASES.mainnet);
    const tx = TransactionBuilder.fromXDR(c.transaction, PASSPHRASES.mainnet);
    expect(tx.source).toBe(deps.signing.publicKey());
    expect(tx.signatures).toHaveLength(1);
  });
  it('rejects a non-G address with 400 invalid_args', () => {
    expect(() => buildChallenge(deps, 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'testnet')).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args' }));
  });
  it('verifies a client-signed challenge exactly once', () => {
    const v = new ChallengeVerifier(deps);
    const signed = sign(buildChallenge(deps, client.publicKey(), 'testnet').transaction, client);
    expect(v.verify(signed, 'testnet')).toBe(client.publicKey());
    expect(() => v.verify(signed, 'testnet')).toThrow(expect.objectContaining({ status: 401, error: 'invalid_challenge' }));
  });
  it('rejects an unsigned, a wrongly signed, a wrong-network and a foreign-server challenge', () => {
    const v = new ChallengeVerifier(deps);
    const unsigned = buildChallenge(deps, client.publicKey(), 'testnet').transaction;
    expect(() => v.verify(unsigned, 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => v.verify(sign(unsigned, Keypair.random()), 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => v.verify(sign(unsigned, client), 'mainnet')).toThrow(expect.objectContaining({ status: 401 }));
    const foreign = buildChallenge({ ...deps, signing: Keypair.random() }, client.publicKey(), 'testnet').transaction;
    expect(() => v.verify(sign(foreign, client), 'testnet')).toThrow(expect.objectContaining({ status: 401 }));
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd server && npx vitest run test/auth`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`server/src/auth/keys.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { Store } from '../registry/store.js';

export type AuthKeys = { secret: Uint8Array; signing: Keypair };

/**
 * The JWT secret and the challenge-signing keypair are generated once and kept in `settings`, so a
 * fresh deployment needs no secret env vars and a restart keeps every session valid. `AUTH_SECRET`
 * (base64, 32 bytes) and `AUTH_SIGNING_SEED` (S…) override without being written back — tests use that.
 */
export async function loadAuthKeys(store: Store, env: NodeJS.ProcessEnv): Promise<AuthKeys> {
  const secretB64 = env.AUTH_SECRET || (await store.getSetting('auth_secret')) || (await persist(store, 'auth_secret', randomBytes(32).toString('base64')));
  const seed = env.AUTH_SIGNING_SEED || (await store.getSetting('auth_signing_seed')) || (await persist(store, 'auth_signing_seed', Keypair.random().secret()));
  return { secret: new Uint8Array(Buffer.from(secretB64, 'base64')), signing: Keypair.fromSecret(seed) };
}
async function persist(store: Store, key: string, value: string) { await store.setSetting(key, value); return value; }
```

`server/src/auth/jwt.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_TTL_S = 24 * 3600;
export type Session = { address: string; expiresAt: string };

export async function issueToken(secret: Uint8Array, issuer: string, address: string, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const iat = Math.floor(now / 1000); const exp = iat + SESSION_TTL_S;
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(address).setIssuer(issuer).setIssuedAt(iat).setExpirationTime(exp).sign(secret);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** null for anything that is not a currently valid token issued by us — callers turn that into 401. */
export async function verifyToken(secret: Uint8Array, issuer: string, token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer, algorithms: ['HS256'] });
    if (!payload.sub || !payload.exp) return null;
    return { address: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch { return null; }
}
```

`server/src/auth/challenge.ts`:

```ts
import { Keypair, StrKey, WebAuth } from '@stellar/stellar-sdk';
import { PASSPHRASES } from '../config.js';
import type { Network } from '../types.js';
import { ApiError, badRequest } from '../errors.js';

export const CHALLENGE_TTL_S = 300;
export type ChallengeDeps = { signing: Keypair; homeDomain: string; webAuthDomain: string };

/** SEP-10 challenge: a never-submitted transaction the wallet signs to prove it holds `address`. */
export function buildChallenge(d: ChallengeDeps, address: string, network: Network): { transaction: string; networkPassphrase: string } {
  if (!StrKey.isValidEd25519PublicKey(address)) throw badRequest('invalid_args', 'address must be a G… ed25519 public key', { path: 'address' });
  const networkPassphrase = PASSPHRASES[network];
  return { transaction: WebAuth.buildChallengeTx(d.signing, address, d.homeDomain, CHALLENGE_TTL_S, networkPassphrase, d.webAuthDomain), networkPassphrase };
}

const rejected = (why: string) => new ApiError(401, 'invalid_challenge', `challenge rejected: ${why}`);

export class ChallengeVerifier {
  /** tx hash (hex) → expiry (ms); a signed challenge is good for one token only. */
  private used = new Map<string, number>();
  constructor(private d: ChallengeDeps) {}

  verify(signedXdr: string, network: Network, now = Date.now()): string {
    const passphrase = PASSPHRASES[network]; const server = this.d.signing.publicKey();
    let clientAccountID: string; let hash: string;
    try {
      const r = WebAuth.readChallengeTx(signedXdr, server, passphrase, this.d.homeDomain, this.d.webAuthDomain);
      clientAccountID = r.clientAccountID; hash = r.tx.hash().toString('hex');
      const signers = WebAuth.verifyChallengeTxSigners(signedXdr, server, passphrase, [clientAccountID], this.d.homeDomain, this.d.webAuthDomain);
      if (!signers.includes(clientAccountID)) throw new Error('not signed by the client account');
    } catch (e) { throw rejected((e as Error).message); }
    for (const [h, exp] of this.used) if (exp <= now) this.used.delete(h);
    if (this.used.has(hash)) throw rejected('already used');
    this.used.set(hash, now + CHALLENGE_TTL_S * 1000);
    return clientAccountID;
  }
}
```

- [ ] **Step 5: Run the auth tests**

Run: `cd server && npx vitest run test/auth && npm run typecheck`
Expected: all PASS, typecheck clean. If `verifyChallengeTxSigners` throws for the unsigned case instead of returning an empty list, that is fine — the test only requires a 401.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/src/auth server/test/auth
git commit -m "server: auth keys, HS256 session tokens, SEP-10 challenge verifier" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `/auth/*` routes, `requireSession`, CORS, wiring

**Files:**
- Create: `server/src/http/session.ts`, `server/src/http/routes/auth.ts`, `server/test/helpers/session.ts`, `server/test/http/auth.test.ts`
- Modify: `server/src/http/deps.ts`, `server/src/http/app.ts:17,31-35`, `server/src/config.ts`, `server/src/main.ts`, `server/test/helpers/app.ts`

**Interfaces:**
- Consumes: Task 2 modules.
- Produces: `Deps.auth: { keys: AuthKeys; challenge: ChallengeDeps; verifier: ChallengeVerifier }`; `Config.authHomeDomain: string`; `sessionOf(deps, req): Promise<Session | null>`; `requireSession(deps, req): Promise<Session>` (throws `ApiError(401, 'unauthorized', …)`); test helper `signInAs(app, kp, network = 'testnet'): Promise<{ token: string; address: string }>` and `bearer(token) => { authorization: 'Bearer <token>' }`.
- Routes: `POST /auth/challenge {address, network} → 200 {transaction, network_passphrase}`; `POST /auth/token {transaction, network} → 200 {token, address, expires_at}`; `GET /auth/me → 200 {address, expires_at}`.

- [ ] **Step 1: Failing tests**

`server/test/helpers/session.ts`:

```ts
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import type { FastifyInstance } from 'fastify';
import { PASSPHRASES } from '../../src/config.js';

/** Runs the real challenge → sign → token flow against an app under test. */
export async function signInAs(app: FastifyInstance, kp: Keypair, network: 'testnet' | 'mainnet' = 'testnet') {
  const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network } });
  if (ch.statusCode !== 200) throw new Error(`challenge: ${ch.body}`);
  const tx = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES[network]); tx.sign(kp);
  const tok = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: tx.toXDR(), network } });
  if (tok.statusCode !== 200) throw new Error(`token: ${tok.body}`);
  return { token: tok.json().token as string, address: kp.publicKey() };
}
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
```

`server/test/http/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { signInAs, bearer } from '../helpers/session.js';
import { PASSPHRASES } from '../../src/config.js';

describe('auth routes', () => {
  it('challenge → token → me', async () => {
    const { app } = await testApp();
    const kp = Keypair.random();
    const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network: 'testnet' } });
    expect(ch.statusCode).toBe(200);
    expect(ch.json()).toMatchObject({ network_passphrase: PASSPHRASES.testnet });
    const { token, address } = await signInAs(app, kp);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ address, expires_at: expect.any(String) });
  });
  it('rejects bad input and unsigned/foreign challenges', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: 'nope', network: 'testnet' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: Keypair.random().publicKey(), network: 'futurenet' } })).statusCode).toBe(400);
    const kp = Keypair.random();
    const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: kp.publicKey(), network: 'testnet' } });
    const unsigned = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: ch.json().transaction, network: 'testnet' } });
    expect(unsigned.statusCode).toBe(401); expect(unsigned.json().error).toBe('invalid_challenge');
    const tx = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES.testnet); tx.sign(Keypair.random());
    expect((await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: tx.toXDR(), network: 'testnet' } })).statusCode).toBe(401);
  });
  it('/auth/me is 401 unauthorized without or with a bad token', async () => {
    const { app } = await testApp();
    const none = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(none.statusCode).toBe(401); expect(none.json()).toEqual({ error: 'unauthorized', message: expect.any(String) });
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: bearer('garbage') })).statusCode).toBe(401);
  });
  it('CORS preflight allows the Authorization header for a configured origin', async () => {
    const { app } = await testApp({ CORS_ORIGINS: 'https://sonata.test' });
    const res = await app.inject({ method: 'OPTIONS', url: '/auth/me', headers: { origin: 'https://sonata.test', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe('https://sonata.test');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('authorization');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run test/http/auth.test.ts`
Expected: FAIL (routes 404; `signInAs` throws).

- [ ] **Step 3: Config + deps**

`server/src/config.ts`: add `authHomeDomain: string;` to `Config` and in `loadConfig` return, after `corsOrigins`:

```ts
    authHomeDomain: env.AUTH_HOME_DOMAIN || hostOf((env.CORS_ORIGINS || 'http://localhost:3000').split(',')[0].trim()),
```

and at the bottom of the file:

```ts
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return 'localhost'; } };
```

`server/src/http/deps.ts`:

```ts
import type pino from 'pino';
import type { Config } from '../config.js';
import type { Chain } from '../chain/types.js';
import type { Registry } from '../registry/registry.js';
import type { Store } from '../registry/store.js';
import type { AuthKeys } from '../auth/keys.js';
import type { ChallengeDeps, ChallengeVerifier } from '../auth/challenge.js';
export type Auth = { keys: AuthKeys; challenge: ChallengeDeps; verifier: ChallengeVerifier };
export type Deps = { cfg: Config; chain: Chain; registry: Registry; store: Store; log: pino.Logger; auth: Auth };
```

- [ ] **Step 4: Session helper + routes**

`server/src/http/session.ts`:

```ts
import type { FastifyRequest } from 'fastify';
import type { Deps } from './deps.js';
import { ApiError } from '../errors.js';
import { verifyToken, type Session } from '../auth/jwt.js';

/** The session a request carries, or null when there is no (valid) bearer token. */
export async function sessionOf(deps: Deps, req: FastifyRequest): Promise<Session | null> {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return verifyToken(deps.auth.keys.secret, deps.cfg.publicBaseUrl, h.slice(7).trim());
}
export async function requireSession(deps: Deps, req: FastifyRequest): Promise<Session> {
  const s = await sessionOf(deps, req);
  if (!s) throw new ApiError(401, 'unauthorized', 'a valid "Authorization: Bearer <token>" header is required — sign in with your wallet first');
  return s;
}
```

`server/src/http/routes/auth.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { buildChallenge } from '../../auth/challenge.js';
import { issueToken } from '../../auth/jwt.js';
import { requireSession } from '../session.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const ChallengeBody = z.object({ address: z.string(), network: NETWORK });
const TokenBody = z.object({ transaction: z.string().min(1), network: NETWORK });

export const authRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.post('/auth/challenge', async (req) => {
    const b = ChallengeBody.parse(req.body);
    const c = buildChallenge(deps.auth.challenge, b.address, b.network);
    return { transaction: c.transaction, network_passphrase: c.networkPassphrase };
  });
  app.post('/auth/token', async (req) => {
    const b = TokenBody.parse(req.body);
    const address = deps.auth.verifier.verify(b.transaction, b.network);
    const t = await issueToken(deps.auth.keys.secret, deps.cfg.publicBaseUrl, address);
    req.log.info({ address }, 'session issued');
    return { token: t.token, address, expires_at: t.expiresAt };
  });
  app.get('/auth/me', async (req) => {
    const s = await requireSession(deps, req);
    return { address: s.address, expires_at: s.expiresAt };
  });
};
```

`server/src/http/app.ts`: change the cors registration to

```ts
  app.register(cors, { origin: (origin, cb) => cb(null, !origin || deps.cfg.corsOrigins.includes(origin) || deps.cfg.corsOrigins.includes('*')), methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'authorization'] });
```

and add `import { authRoutes } from './routes/auth.js';` + `app.register(authRoutes(deps));` next to the other route registrations.

- [ ] **Step 5: Wire main and the test helper**

`server/src/main.ts` — after `const store = new PgStore(pool);` add:

```ts
const keys = await loadAuthKeys(store, process.env);
const challenge = { signing: keys.signing, homeDomain: cfg.authHomeDomain, webAuthDomain: new URL(cfg.publicBaseUrl).host };
const auth = { keys, challenge, verifier: new ChallengeVerifier(challenge) };
```

with imports `import { loadAuthKeys } from './auth/keys.js'; import { ChallengeVerifier } from './auth/challenge.js';`, and pass `auth` into `buildApp({ cfg, chain, registry, store, log, auth })`. Log line: add `homeDomain: cfg.authHomeDomain` to the "sonata server up" info.

`server/test/helpers/app.ts` — build the same `auth` object from `loadAuthKeys(store, {})` (fresh random keys per app) with `homeDomain: cfg.authHomeDomain` and `webAuthDomain: 'api.sonata.test'`, pass it to `buildApp`, and return it from `testApp` (`return { app, chain, store, registry, cfg, auth, registerFixture }`). Keep `registerFixture` but make it register with an owner: `registry.register(FIXTURE_ID, 'testnet', 'KitchenSink', OWNER)` where `export const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';` is exported from the helper.

- [ ] **Step 6: Run everything**

Run: `cd server && npm test && npm run typecheck`
Expected: `auth.test.ts` PASS; all other suites still PASS (they do not send tokens yet — Task 4 changes that).

- [ ] **Step 7: Commit**

```bash
git add server/src server/test/helpers server/test/http/auth.test.ts
git commit -m "server: /auth challenge+token+me, session helper, CORS authorization header" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: ownership on register, PATCH and the list

**Files:**
- Modify: `server/src/http/routes/contracts.ts` (whole file below), `server/test/http/contracts.test.ts`, `server/test/e2e/flow.test.ts:14-27`

**Interfaces:**
- Consumes: `requireSession`, `sessionOf` (Task 3), `Registry.register(id, network, name, owner)` (Task 1).
- Produces: `publicRow(...).owner`; list items with `owner` + `created_at`; `?owner=me`.

- [ ] **Step 1: Failing tests**

Append to `server/test/http/contracts.test.ts` (inside the top-level `describe`), with `import { Keypair } from '@stellar/stellar-sdk'; import { signInAs, bearer } from '../helpers/session.js';` added at the top:

```ts
  it('POST /contracts and PATCH /c/:id require a session', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const post = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' } });
    expect(post.statusCode).toBe(401); expect(post.json().error).toBe('unauthorized');
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'X' } });
    expect(patch.statusCode).toBe(401);
  });
  it('the registering wallet owns the contract; another wallet gets 403 not_owner', async () => {
    const { app, registry } = await testApp();
    const alice = await signInAs(app, Keypair.random()); const bob = await signInAs(app, Keypair.random());
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KS' }, headers: bearer(alice.token) });
    expect(res.statusCode).toBe(202); await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` })).json().owner).toBe(alice.address);
    const again = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(bob.token) });
    expect(again.statusCode).toBe(403); expect(again.json()).toMatchObject({ error: 'not_owner', details: { owner: alice.address } });
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' }, headers: bearer(bob.token) });
    expect(patch.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' }, headers: bearer(alice.token) });
    expect(ok.statusCode).toBe(200); expect(ok.json().mcp_scope).toBe('rw');
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    expect(list.json()[0]).toMatchObject({ id: FIXTURE_ID, owner: alice.address, created_at: expect.any(String) });
  });
  it('a legacy (ownerless) contract is claimed by the first wallet that registers or patches it', async () => {
    const { app, registry, store } = await testApp();
    await registry.register(FIXTURE_ID, 'testnet', 'Legacy', null); await registry.whenIdle();
    expect((await store.get(FIXTURE_ID))!.owner).toBeNull();
    const carol = await signInAs(app, Keypair.random());
    const patch = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Claimed' }, headers: bearer(carol.token) });
    expect(patch.statusCode).toBe(200); expect(patch.json()).toMatchObject({ name: 'Claimed', owner: carol.address });
    const dave = await signInAs(app, Keypair.random());
    expect((await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { name: 'Nope' }, headers: bearer(dave.token) })).statusCode).toBe(403);
  });
  it('GET /contracts?owner=me lists only the caller\'s contracts and needs a session', async () => {
    const { app, registry } = await testApp();
    const alice = await signInAs(app, Keypair.random());
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(alice.token) });
    await registry.register('CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', 'testnet', 'Other', 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
    await registry.whenIdle();
    expect((await app.inject({ method: 'GET', url: '/contracts' })).json()).toHaveLength(2);
    const mine = await app.inject({ method: 'GET', url: '/contracts?owner=me', headers: bearer(alice.token) });
    expect(mine.json().map((c: any) => c.id)).toEqual([FIXTURE_ID]);
    expect((await app.inject({ method: 'GET', url: '/contracts?owner=me' })).statusCode).toBe(401);
  });
```

Then update the existing tests in the same file so they authenticate: at the top of each test that injects `POST /contracts` or `PATCH /c/:id` (tests "POST /contracts validates…", "PATCH /c/:id updates name and scope…", "PATCH /c/:id regenerates…", "re-registering with a new name…", "POST /contracts is 400 network_not_configured…") add `const { token } = await signInAs(app, Keypair.random());` and pass `headers: bearer(token)` on those injects. In "POST /contracts validates…" the invalid-id and invalid-network calls must also carry the header (validation still returns 400 after auth). `registerFixture()` registers with `OWNER` from the helper, so PATCH tests must sign in as that owner: import `OWNER` and use `signInAs(app, Keypair.fromRawEd25519Seed(...))` is not possible for a fixed public key — instead, in those tests register through the API with the signed-in wallet (`POST /contracts` with the token, then `registry.whenIdle()`) instead of `registerFixture()`. Update the "GET /contracts lists" expectation to `{ id, name: 'KitchenSink', network: 'testnet', status: 'ready', fns: 16, owner: OWNER, created_at: expect.any(String), updated_at: expect.any(String) }`.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run test/http/contracts.test.ts`
Expected: the new tests FAIL (no 401/403, no `owner`).

- [ ] **Step 3: Implement the routes**

Replace `server/src/http/routes/contracts.ts` with:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { ContractRow } from '../../registry/store.js';
import { ApiError, notFound } from '../../errors.js';
import { requireSession } from '../session.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const RegisterBody = z.object({ id: z.string(), network: NETWORK, name: z.string().min(1).max(80).optional() });
const PatchBody = z.object({ name: z.string().min(1).max(80).nullable().optional(), mcp_scope: z.enum(['ro', 'rw']).optional() });

export const publicRow = (row: ContractRow, base: string) => ({
  ...(row.model ?? { id: row.id, network: row.network, name: row.name }),
  name: row.name, owner: row.owner, mcp_scope: row.mcpScope, status: row.status, steps: row.steps, error: row.error,
  urls: { mcp: `${base}/c/${row.id}/mcp`, llms: `${base}/c/${row.id}/llms.txt`, openapi: `${base}/c/${row.id}/openapi.json` },
  created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString()
});

const listItem = (r: ContractRow) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, owner: r.owner, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() });
const notOwner = (owner: string) => new ApiError(403, 'not_owner', 'this contract was registered by another wallet', { details: { owner } });

export const contractRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const base = deps.cfg.publicBaseUrl;

  /** The row the caller may change: 404 unknown, 403 someone else's, and a legacy NULL owner is claimed on the spot. */
  const ownedRow = async (id: string, address: string) => {
    const row = await deps.store.get(id); if (!row) throw notFound('contract', id);
    if (row.owner && row.owner !== address) throw notOwner(row.owner);
    if (!row.owner) { deps.log.info({ id, address }, 'legacy contract claimed'); return deps.store.update(id, { owner: address }); }
    return row;
  };

  app.post('/contracts', async (req, reply) => {
    const s = await requireSession(deps, req);
    const b = RegisterBody.parse(req.body);
    if (!deps.cfg.networks[b.network]) return reply.code(400).send({ error: 'network_not_configured', message: `network ${b.network} is not configured on this server` });
    const existing = await deps.store.get(b.id);
    if (existing?.owner && existing.owner !== s.address) throw notOwner(existing.owner);
    if (existing && !existing.owner) deps.log.info({ id: b.id, address: s.address }, 'legacy contract claimed');
    const row = await deps.registry.register(b.id, b.network, b.name ?? null, s.address);
    return reply.code(202).send({ id: row.id, network: row.network, status: row.status, steps: row.steps });
  });
  app.get<{ Querystring: { owner?: string } }>('/contracts', async (req) => {
    if (req.query.owner === undefined) return (await deps.store.list()).map(listItem);
    if (req.query.owner !== 'me') throw new ApiError(400, 'invalid_args', 'owner may only be "me"', { details: { path: 'owner' } });
    const s = await requireSession(deps, req);
    return (await deps.store.list({ owner: s.address })).map(listItem);
  });
  app.get<{ Params: { id: string } }>('/c/:id', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return publicRow(row, base);
  });
  app.get<{ Params: { id: string } }>('/c/:id/status', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return { status: row.status, steps: row.steps, error: row.error };
  });
  app.patch<{ Params: { id: string } }>('/c/:id', async (req) => {
    const s = await requireSession(deps, req);
    const b = PatchBody.parse(req.body);
    const row = await ownedRow(req.params.id, s.address);
    if (b.mcp_scope !== undefined) await deps.store.update(row.id, { mcpScope: b.mcp_scope });
    if (b.name !== undefined) await deps.registry.rename(row.id, b.name);   // also regenerates llms.txt + openapi
    deps.registry.invalidate(row.id);
    return publicRow((await deps.store.get(row.id))!, base);
  });
};
```

- [ ] **Step 4: e2e suite registers with a token**

In `server/test/e2e/flow.test.ts` `setUp`: after `app.listen(...)`, replace the `app.inject({ method: 'POST', url: '/contracts', … })` line with the real flow:

```ts
  const ch = await app.inject({ method: 'POST', url: '/auth/challenge', payload: { address: G, network: 'testnet' } });
  const challenge = TransactionBuilder.fromXDR(ch.json().transaction, PASSPHRASES.testnet); challenge.sign(kp);
  const tok = await app.inject({ method: 'POST', url: '/auth/token', payload: { transaction: challenge.toXDR(), network: 'testnet' } });
  token = tok.json().token;
  await app.inject({ method: 'POST', url: '/contracts', payload: { id: ID, network: 'testnet', name: 'KitchenSink' }, headers: { authorization: `Bearer ${token}` } });
```

declare `let token: string;` next to the other module-level lets, build `auth` for `buildApp` exactly as `test/helpers/app.ts` does (`loadAuthKeys(store, {})`, `homeDomain: cfg.authHomeDomain`, `webAuthDomain: '127.0.0.1'`), and in the MCP test send the header on the `PATCH` (`headers: { authorization: \`Bearer ${token}\` }`). Add the `MCP` test's `mcp_scope` reset if needed — not required (in-process app).

- [ ] **Step 5: Run everything**

Run: `cd server && npm test && npm run typecheck`
Expected: all PASS. Then, only if `server/.env.test` exists locally: `npm run test:e2e` → PASS (it registers with a real signed challenge on testnet).

- [ ] **Step 6: Commit**

```bash
git add server/src/http/routes/contracts.ts server/test/http/contracts.test.ts server/test/e2e/flow.test.ts
git commit -m "server: wallet ownership on register/PATCH, owner in rows, ?owner=me" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: SAC → `sac_unsupported`, server docs/env

**Files:**
- Modify: `server/src/chain/errors.ts`, `server/src/chain/rpc.ts:43-50`, `server/test/chain/rpc.test.ts` (describe `RpcChain.getContractWasm`), `server/test/http/contracts.test.ts`, `server/.env.example`, `server/README.md`

- [ ] **Step 1: Failing tests**

In `server/test/chain/rpc.test.ts`, inside `describe('RpcChain.getContractWasm')` add:

```ts
  it('maps the SDK\'s SAC rejection to 400 sac_unsupported', async () => {
    const server = { getContractWasmByContractId: vi.fn().mockRejectedValue(new Error(`Contract ${FIXTURE_ID} is a Stellar Asset Contract (SAC), which has no Wasm bytecode. Use contract.getSpec instead.`)) };
    await expect(chainWith(server).getContractWasm('testnet', FIXTURE_ID)).rejects.toMatchObject({ status: 400, error: 'sac_unsupported', message: expect.stringContaining('Stellar Asset Contract') });
  });
```

In `server/test/http/contracts.test.ts` add:

```ts
  it('registering a SAC fails the fetch step with a readable sac_unsupported error', async () => {
    const { app, chain, registry } = await testApp();
    const { token } = await signInAs(app, Keypair.random());
    chain.impl.getContractWasm = async () => { throw sacUnsupported(FIXTURE_ID); };
    await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet' }, headers: bearer(token) });
    await registry.whenIdle();
    const st = (await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/status` })).json();
    expect(st.status).toBe('failed');
    expect(st.steps[0]).toMatchObject({ name: 'fetch', status: 'failed', error: expect.stringContaining('Stellar Asset Contract') });
  });
```

with `import { sacUnsupported } from '../../src/chain/errors.js';`.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run test/chain/rpc.test.ts test/http/contracts.test.ts`
Expected: FAIL (`sacUnsupported` missing; RpcChain returns 502).

- [ ] **Step 3: Implement**

`server/src/chain/errors.ts` — add:

```ts
export const sacUnsupported = (id: string) =>
  new ChainError(400, 'sac_unsupported', `contract ${id} is a Stellar Asset Contract (SAC) — it has no WASM spec; SAC support arrives in a later release`);
/** stellar-sdk 17 rejects a SAC from getContractWasmByContractId with an Error carrying this phrase. */
export const isSacError = (e: unknown) => /Stellar Asset Contract/i.test(String((e as Error)?.message ?? e));
```

`server/src/chain/rpc.ts` `getContractWasm` — the catch becomes:

```ts
      catch (e) {
        if (isNotFound(e)) throw contractNotFound(network, id);   // 404 → a readable 404, not the 502 rpcUnavailable fallback
        if (isSacError(e)) throw sacUnsupported(id);
        throw e;
      }
```

(import `isSacError, sacUnsupported` from `./errors.js`).

- [ ] **Step 4: Docs and env**

`server/.env.example` — append:

```
AUTH_HOME_DOMAIN= # optional; defaults to the host of the first CORS_ORIGINS entry
AUTH_SECRET= # optional override; otherwise generated once into the settings table
AUTH_SIGNING_SEED= # optional override (S…); otherwise generated once into the settings table
```

`server/README.md` — in the endpoints table add rows for `POST /auth/challenge`, `POST /auth/token`, `GET /auth/me`, mark `POST /contracts` and `PATCH /c/:id` as "session required (owner)", add `owner`/`created_at` to the `GET /contracts` shape and `?owner=me`, add `400 sac_unsupported` to the notes, and a short "Ownership" paragraph (wallet signs a SEP-10 challenge, 24 h token, first registrant owns, legacy rows claimable).

- [ ] **Step 5: Run everything, commit**

Run: `cd server && npm test && npm run typecheck` → all PASS.

```bash
git add server/src/chain server/test server/.env.example server/README.md
git commit -m "server: sac_unsupported, auth docs and env example" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: site session store + API client auth

**Files:**
- Create: `lib/session.js`, `test/site/session.test.js`
- Modify: `lib/api.js`, `test/site/api.test.js`

**Interfaces:**
- Produces: `getSession() → { token, address, expires_at } | null`, `setSession(s)`, `clearSession()`, `onSessionChange(fn) → unsubscribe`; `api()` sends `Authorization` when a session exists and clears it on 401; `contracts.list({ mine, signal })`, `contracts.submit(id, xdr)`, `auth.challenge(address, network)`, `auth.token(transaction, network)`, `auth.me()`, `health()`, `PASSPHRASES`.

- [ ] **Step 1: Failing tests**

`test/site/session.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSession, setSession, clearSession, onSessionChange } from '@/lib/session';

const future = () => new Date(Date.now() + 3600_000).toISOString();
const S = { token: 't', address: 'GABC', expires_at: future() };

describe('session store', () => {
  beforeEach(() => localStorage.clear());
  it('round-trips through localStorage', () => {
    expect(getSession()).toBeNull();
    setSession(S);
    expect(getSession()).toEqual(S);
    expect(JSON.parse(localStorage.getItem('sonata.session'))).toEqual(S);
    clearSession();
    expect(getSession()).toBeNull();
  });
  it('drops an expired or malformed session on read', () => {
    localStorage.setItem('sonata.session', JSON.stringify({ ...S, expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('sonata.session')).toBeNull();
    localStorage.setItem('sonata.session', '{not json');
    expect(getSession()).toBeNull();
  });
  it('notifies listeners on set and clear', () => {
    const fn = vi.fn(); const off = onSessionChange(fn);
    setSession(S); expect(fn).toHaveBeenLastCalledWith(S);
    clearSession(); expect(fn).toHaveBeenLastCalledWith(null);
    off(); setSession(S); expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

Append to `test/site/api.test.js` (inside `describe('api()')`, which already stubs `fetch`; add `import { setSession, getSession, clearSession } from '@/lib/session';` and `afterEach(() => clearSession())`):

```js
  it('sends Authorization when a session exists and clears it on 401', async () => {
    setSession({ token: 'tok', address: 'GABC', expires_at: new Date(Date.now() + 60_000).toISOString() });
    fetch.mockResolvedValue(json(200, []));
    await contracts.list({ mine: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API_URL + '/contracts?owner=me');
    expect(init.headers.authorization).toBe('Bearer tok');
    fetch.mockResolvedValue(json(401, { error: 'unauthorized', message: 'nope' }));
    await expect(api('/auth/me')).rejects.toMatchObject({ status: 401, error: 'unauthorized' });
    expect(getSession()).toBeNull();
  });
  it('auth and submit helpers hit the right routes', async () => {
    fetch.mockResolvedValue(json(200, {}));
    await auth.challenge('GABC', 'testnet');
    expect(fetch.mock.calls[0][0]).toBe(API_URL + '/auth/challenge');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ address: 'GABC', network: 'testnet' });
    await auth.token('AAAA', 'mainnet');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ transaction: 'AAAA', network: 'mainnet' });
    await contracts.submit(ID, 'AAAA');
    expect(fetch.mock.calls[2][0]).toBe(`${API_URL}/c/${ID}/submit`);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ xdr: 'AAAA' });
  });
```

(add `auth` to the import from `@/lib/api`).

- [ ] **Step 2: Run to see them fail**

Run: `npm test -- test/site/session.test.js test/site/api.test.js`
Expected: FAIL (module missing; no header; `auth` undefined).

- [ ] **Step 3: Implement**

`lib/session.js`:

```js
const KEY = 'sonata.session';
const listeners = new Set();
const notify = () => { const s = getSession(); for (const fn of listeners) fn(s); };

/** { token, address, expires_at } or null; an expired or unreadable entry is removed on read. */
export function getSession() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.token !== 'string' || typeof s.address !== 'string' || !(Date.parse(s.expires_at) > Date.now())) { localStorage.removeItem(KEY); return null; }
    return s;
  } catch { try { localStorage.removeItem(KEY); } catch {} return null; }
}
export function setSession(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} notify(); }
export function clearSession() { try { localStorage.removeItem(KEY); } catch {} notify(); }
export function onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
```

`lib/api.js` — changes:

```js
import { getSession, clearSession } from './session';

export const PASSPHRASES = { testnet: 'Test SDF Network ; September 2015', mainnet: 'Public Global Stellar Network ; September 2015' };
```

In `api()`, build headers as:

```js
    const session = getSession();
    const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(session ? { authorization: `Bearer ${session.token}` } : {}) };
```

and use `headers` in the `fetch` call. In the `!res.ok` branch, before throwing: `if (res.status === 401) clearSession();`.

Replace the `contracts` object's `list` and add `submit`, plus new exports:

```js
  list: ({ mine = false, ...o } = {}) => api(mine ? '/contracts?owner=me' : '/contracts', o),
  submit: (id, xdr, o) => api(`/c/${id}/submit`, { ...o, method: 'POST', body: { xdr } }),
```

```js
export const auth = {
  challenge: (address, network, o) => api('/auth/challenge', { ...o, method: 'POST', body: { address, network } }),
  token: (transaction, network, o) => api('/auth/token', { ...o, method: 'POST', body: { transaction, network } }),
  me: (o) => api('/auth/me', o)
};
export const health = (o) => api('/healthz', o);
export const shortAddr = (g) => (g ? g.slice(0, 4) + '…' + g.slice(-4) : '');
```

Callers of `contracts.list(o)` that passed `{ signal }` keep working (`signal` is forwarded through `...o`).

- [ ] **Step 4: Run, commit**

Run: `npm test` → all PASS (existing `list` test, if any, still passes because the URL is unchanged without `mine`).

```bash
git add lib/session.js lib/api.js test/site/session.test.js test/site/api.test.js
git commit -m "site: session store, bearer auth in the API client, auth/submit helpers" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `lib/wallet.js` (Stellar Wallets Kit wrapper)

**Files:**
- Create: `lib/wallet.js`, `test/site/wallet.test.js`
- Modify: `package.json` (dependency)

**Interfaces:**
- Produces: `connect() → Promise<string>` (address), `getAddress() → Promise<string | null>`, `getNetwork() → Promise<{ network: 'testnet' | 'mainnet', networkPassphrase }>`, `signTransaction(xdr, networkPassphrase, address) → Promise<string>`, `disconnect() → Promise<void>`, `class WalletError extends Error { code: 'rejected' | 'network' | 'unavailable' | 'unknown' }`, `_setKitForTests(kit)`.

- [ ] **Step 1: Install**

Run: `npm i @creit.tech/stellar-wallets-kit@^2.6`
Expected: dependency added; `node_modules/@creit.tech/stellar-wallets-kit/package.json` has `exports['./sdk']` and `exports['./modules/freighter']`.

- [ ] **Step 2: Failing test**

`test/site/wallet.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as wallet from '@/lib/wallet';

const PUB = 'Public Global Stellar Network ; September 2015';
const TEST = 'Test SDF Network ; September 2015';
const fakeKit = (over = {}) => ({
  authModal: vi.fn().mockResolvedValue({ address: 'GABC' }),
  getAddress: vi.fn().mockResolvedValue({ address: 'GABC' }),
  getNetwork: vi.fn().mockResolvedValue({ network: 'PUBLIC', networkPassphrase: PUB }),
  signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'SIGNED' }),
  disconnect: vi.fn().mockResolvedValue(undefined),
  ...over
});

describe('wallet', () => {
  beforeEach(() => localStorage.clear());
  it('connects through the auth modal and returns the address', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    expect(await wallet.connect()).toBe('GABC');
    expect(kit.authModal).toHaveBeenCalled();
  });
  it('maps the kit network to ours and falls back to testnet', async () => {
    wallet._setKitForTests(fakeKit());
    expect(await wallet.getNetwork()).toEqual({ network: 'mainnet', networkPassphrase: PUB });
    wallet._setKitForTests(fakeKit({ getNetwork: vi.fn().mockRejectedValue(new Error('no')) }));
    expect(await wallet.getNetwork()).toEqual({ network: 'testnet', networkPassphrase: TEST });
    wallet._setKitForTests(fakeKit({ getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET', networkPassphrase: TEST }) }));
    expect((await wallet.getNetwork()).network).toBe('testnet');
  });
  it('signs with the passphrase and address, returning the signed xdr', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    expect(await wallet.signTransaction('AAAA', TEST, 'GABC')).toBe('SIGNED');
    expect(kit.signTransaction).toHaveBeenCalledWith('AAAA', { networkPassphrase: TEST, address: 'GABC' });
  });
  it('normalises wallet errors', async () => {
    wallet._setKitForTests(fakeKit({ signTransaction: vi.fn().mockRejectedValue(new Error('User declined access')) }));
    await expect(wallet.signTransaction('AAAA', TEST, 'GABC')).rejects.toMatchObject({ name: 'WalletError', code: 'rejected' });
    wallet._setKitForTests(fakeKit({ signTransaction: vi.fn().mockRejectedValue(new Error('Network passphrase mismatch')) }));
    await expect(wallet.signTransaction('AAAA', TEST, 'GABC')).rejects.toMatchObject({ code: 'network' });
    wallet._setKitForTests(fakeKit({ authModal: vi.fn().mockRejectedValue(new Error('Modal closed')) }));
    await expect(wallet.connect()).rejects.toMatchObject({ code: 'rejected' });
  });
  it('disconnect clears the remembered wallet', async () => {
    const kit = fakeKit(); wallet._setKitForTests(kit);
    await wallet.connect(); await wallet.disconnect();
    expect(kit.disconnect).toHaveBeenCalled();
    expect(localStorage.getItem('sonata.wallet')).toBeNull();
  });
});
```

- [ ] **Step 3: Run to see it fail**

Run: `npm test -- test/site/wallet.test.js` → FAIL (module missing).

- [ ] **Step 4: Implement**

`lib/wallet.js`:

```js
'use client';
import { PASSPHRASES } from './api';

const WALLET_KEY = 'sonata.wallet';
let kitPromise = null;

export class WalletError extends Error {
  constructor(code, message) { super(message); this.name = 'WalletError'; this.code = code; }
}
/** Wallets phrase rejections and mismatches differently; the UI only needs four buckets. */
function normalise(e) {
  if (e instanceof WalletError) return e;
  const m = String(e?.message || e || '');
  if (/reject|declin|denied|cancel|closed|abort/i.test(m)) return new WalletError('rejected', 'The wallet request was cancelled.');
  if (/network|passphrase/i.test(m)) return new WalletError('network', 'Your wallet is on a different network.');
  if (/not (installed|available|found)|unavailable|no wallet/i.test(m)) return new WalletError('unavailable', 'No Stellar wallet is available in this browser.');
  return new WalletError('unknown', m || 'The wallet returned an error.');
}

/** The kit touches `window` at import time, so it is loaded lazily and only in the browser. */
async function kit() {
  if (!kitPromise) {
    kitPromise = (async () => {
      const [{ StellarWalletsKit }, { FreighterModule }, { xBullModule }, { AlbedoModule }, { LobstrModule }] = await Promise.all([
        import('@creit.tech/stellar-wallets-kit/sdk'),
        import('@creit.tech/stellar-wallets-kit/modules/freighter'),
        import('@creit.tech/stellar-wallets-kit/modules/xbull'),
        import('@creit.tech/stellar-wallets-kit/modules/albedo'),
        import('@creit.tech/stellar-wallets-kit/modules/lobstr')
      ]);
      StellarWalletsKit.init({ modules: [new FreighterModule(), new xBullModule(), new AlbedoModule(), new LobstrModule()] });
      return StellarWalletsKit;
    })().catch((e) => { kitPromise = null; throw normalise(e); });
  }
  return kitPromise;
}
export function _setKitForTests(k) { kitPromise = Promise.resolve(k); }

export async function connect() {
  const k = await kit();
  try {
    const { address } = await k.authModal();
    try { localStorage.setItem(WALLET_KEY, k.selectedWalletId || k.selectedModuleId || 'connected'); } catch {}
    return address;
  } catch (e) { throw normalise(e); }
}
export async function getAddress() {
  try { const { address } = await (await kit()).getAddress(); return address || null; } catch { return null; }
}
export async function getNetwork() {
  try {
    const n = await (await kit()).getNetwork();
    const mainnet = n?.networkPassphrase === PASSPHRASES.mainnet || /public|mainnet/i.test(String(n?.network || ''));
    return mainnet ? { network: 'mainnet', networkPassphrase: PASSPHRASES.mainnet } : { network: 'testnet', networkPassphrase: PASSPHRASES.testnet };
  } catch { return { network: 'testnet', networkPassphrase: PASSPHRASES.testnet }; }
}
export async function signTransaction(xdr, networkPassphrase, address) {
  const k = await kit();
  try { const { signedTxXdr } = await k.signTransaction(xdr, { networkPassphrase, address }); return signedTxXdr; }
  catch (e) { throw normalise(e); }
}
export async function disconnect() {
  try { localStorage.removeItem(WALLET_KEY); } catch {}
  try { const k = await kit(); if (typeof k.disconnect === 'function') await k.disconnect(); } catch {}
}
```

- [ ] **Step 5: Run, build check, commit**

Run: `npm test -- test/site/wallet.test.js` → PASS. Run `npm run build` once to confirm the dynamic imports resolve (the kit is not imported by any page yet, so this only checks packaging).

```bash
git add package.json package-lock.json lib/wallet.js test/site/wallet.test.js
git commit -m "site: wallet kit wrapper with lazy loading and normalised errors" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `signIn`/`signOut`, `SessionProvider`, `WalletButton`, nav

**Files:**
- Create: `lib/auth.js`, `components/SessionProvider.jsx`, `components/WalletButton.jsx`, `test/site/auth.test.js`, `test/site/wallet-button.test.jsx`
- Modify: `components/TopNav.jsx`, `app/layout.jsx`

**Interfaces:**
- Consumes: `lib/wallet`, `lib/session`, `auth` from `lib/api`.
- Produces: `signIn() → Promise<session>`, `signOut()`; `useSession() → { session, address, status: 'anonymous' | 'signing' | 'ready', error, signIn, signOut }`; `<WalletButton />`.

- [ ] **Step 1: Failing tests**

`test/site/auth.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/wallet', () => ({
  connect: vi.fn().mockResolvedValue('GABC'),
  getNetwork: vi.fn().mockResolvedValue({ network: 'testnet', networkPassphrase: 'Test SDF Network ; September 2015' }),
  signTransaction: vi.fn().mockResolvedValue('SIGNED'),
  disconnect: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), auth: { challenge: vi.fn().mockResolvedValue({ transaction: 'CHAL', network_passphrase: 'Test SDF Network ; September 2015' }), token: vi.fn().mockResolvedValue({ token: 'tok', address: 'GABC', expires_at: new Date(Date.now() + 60_000).toISOString() }) } }));
import { signIn, signOut } from '@/lib/auth';
import { getSession } from '@/lib/session';
import * as wallet from '@/lib/wallet';
import { auth } from '@/lib/api';

describe('signIn / signOut', () => {
  beforeEach(() => localStorage.clear());
  it('connect → challenge → sign → token → session', async () => {
    const s = await signIn();
    expect(auth.challenge).toHaveBeenCalledWith('GABC', 'testnet');
    expect(wallet.signTransaction).toHaveBeenCalledWith('CHAL', 'Test SDF Network ; September 2015', 'GABC');
    expect(auth.token).toHaveBeenCalledWith('SIGNED', 'testnet');
    expect(s).toMatchObject({ token: 'tok', address: 'GABC' });
    expect(getSession()).toMatchObject({ token: 'tok' });
    signOut();
    expect(getSession()).toBeNull();
    expect(wallet.disconnect).toHaveBeenCalled();
  });
});
```

`test/site/wallet-button.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({ Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>, Chip: ({ children }) => <span>{children}</span> }) }));
vi.mock('@/lib/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
import { SessionProvider } from '@/components/SessionProvider';
import WalletButton from '@/components/WalletButton';
import { setSession } from '@/lib/session';
import { signIn, signOut } from '@/lib/auth';

const mount = () => render(<SessionProvider><WalletButton /></SessionProvider>);

describe('WalletButton', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  it('offers to connect when anonymous and signs in on click', async () => {
    signIn.mockImplementation(async () => { const s = { token: 't', address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ', expires_at: new Date(Date.now() + 60_000).toISOString() }; setSession(s); return s; });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await waitFor(() => expect(screen.getByText('GABC…WXYZ')).toBeTruthy());
  });
  it('shows the address and disconnects', async () => {
    setSession({ token: 't', address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ', expires_at: new Date(Date.now() + 60_000).toISOString() });
    mount();
    await waitFor(() => expect(screen.getByText('GABC…WXYZ')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(signOut).toHaveBeenCalled();
  });
  it('surfaces a wallet error and returns to the connect state', async () => {
    signIn.mockRejectedValue(Object.assign(new Error('The wallet request was cancelled.'), { code: 'rejected' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet' }));
    await waitFor(() => expect(screen.getByText('The wallet request was cancelled.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test -- test/site/auth.test.js test/site/wallet-button.test.jsx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`lib/auth.js`:

```js
'use client';
import * as wallet from './wallet';
import { auth } from './api';
import { setSession, clearSession } from './session';

/** Wallet connect → SEP-10 challenge → wallet signature → session token. Throws WalletError or ApiError. */
export async function signIn() {
  const address = await wallet.connect();
  const net = await wallet.getNetwork();
  const ch = await auth.challenge(address, net.network);
  const signed = await wallet.signTransaction(ch.transaction, ch.network_passphrase, address);
  const t = await auth.token(signed, net.network);
  const session = { token: t.token, address: t.address, expires_at: t.expires_at };
  setSession(session);
  return session;
}
export function signOut() {
  clearSession();
  wallet.disconnect().catch(() => {});
}
```

`components/SessionProvider.jsx`:

```jsx
'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSession, onSessionChange } from '@/lib/session';
import { signIn as doSignIn, signOut as doSignOut } from '@/lib/auth';

const Ctx = createContext(null);
const ANON = { session: null, address: null, status: 'anonymous', error: null, signIn: async () => { throw new Error('SessionProvider missing'); }, signOut: () => {} };

export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);     // null until mount: localStorage is browser-only
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setSession(getSession()); return onSessionChange(setSession); }, []);
  const signIn = useCallback(async () => {
    setError(null); setSigning(true);
    try { return await doSignIn(); }
    catch (e) { setError(e); throw e; }
    finally { setSigning(false); }
  }, []);
  const signOut = useCallback(() => { setError(null); doSignOut(); }, []);
  const value = useMemo(() => ({ session, address: session?.address || null, status: signing ? 'signing' : session ? 'ready' : 'anonymous', error, signIn, signOut }), [session, signing, error, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx) || ANON;
```

`components/WalletButton.jsx`:

```jsx
'use client';
import Link from 'next/link';
import { useSonataUI } from '@/lib/sonata';
import { shortAddr } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';

export default function WalletButton() {
  const S = useSonataUI();
  const { address, status, error, signIn, signOut } = useSession();
  if (!S) return null;
  if (address) return (
    <div className="wallet" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <Link className="sn-mono nav-link" href="/contracts" title={address}>{shortAddr(address)}</Link>
      <S.Button variant="text" size="sm" onClick={signOut}>Disconnect</S.Button>
    </div>
  );
  return (
    <div className="wallet" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {error && <span className="sn-small sn-muted" role="status">{error.message}</span>}
      <S.Button size="sm" disabled={status === 'signing'} onClick={() => signIn().catch(() => {})}>{status === 'signing' ? 'Waiting for wallet…' : 'Connect wallet'}</S.Button>
    </div>
  );
}
```

`components/TopNav.jsx`: remove the Flows entry from `NAV`, import `WalletButton`, and replace the `nav-right` contents with `<WalletButton />` (the "Testnet" chip and the `home` variable go away).

`app/layout.jsx`: `import { SessionProvider } from '@/components/SessionProvider';` and wrap: `<body><SessionProvider><TopNav />{children}<SiteFooter /></SessionProvider></body>`.

- [ ] **Step 4: Run, commit**

Run: `npm test` → PASS; `npm run build` → OK.

```bash
git add lib/auth.js components/SessionProvider.jsx components/WalletButton.jsx components/TopNav.jsx app/layout.jsx test/site/auth.test.js test/site/wallet-button.test.jsx
git commit -m "site: wallet sign-in, session provider and nav wallet button" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Register requires a wallet; Contracts = mine

**Files:**
- Modify: `components/screens/Register.jsx`, `components/screens/Contracts.jsx`
- Create: `test/site/register.test.jsx`

- [ ] **Step 1: Failing test**

`test/site/register.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Field: ({ label, value, onChange, hint }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /><span>{hint}</span></label>,
  Segmented: () => null, Numeral: () => null, Chip: ({ children }) => <span>{children}</span>
}) }));
vi.mock('@/lib/auth', () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { register: vi.fn(), status: vi.fn() } }));
import Register from '@/components/screens/Register';
import { SessionProvider } from '@/components/SessionProvider';
import { setSession } from '@/lib/session';
import { signIn } from '@/lib/auth';
import { contracts } from '@/lib/api';

const ID = 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const S = { token: 't', address: 'GOWNER', expires_at: new Date(Date.now() + 60_000).toISOString() };

describe('Register', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  it('anonymous: the primary button connects first, then registers', async () => {
    signIn.mockImplementation(async () => { setSession(S); return S; });
    contracts.register.mockResolvedValue({ id: ID, status: 'queued', steps: [] });
    render(<SessionProvider><Register initialId={ID} /></SessionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Connect wallet to register' }));
    await waitFor(() => expect(contracts.register).toHaveBeenCalledWith(ID, 'testnet', undefined));
  });
  it('signed in: registers directly and shows not_owner errors', async () => {
    setSession(S);
    contracts.register.mockRejectedValue(Object.assign(new Error('this contract was registered by another wallet'), { error: 'not_owner', status: 403, details: { owner: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' } }));
    render(<SessionProvider><Register initialId={ID} /></SessionProvider>);
    await waitFor(() => screen.getByRole('button', { name: 'Generate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(screen.getByText(/registered by another wallet \(GBRP…OX2H\)/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- test/site/register.test.jsx` → FAIL (button is "Generate" while anonymous; no owner message).

- [ ] **Step 3: Implement**

`components/screens/Register.jsx` — add `import { useSession } from '@/components/SessionProvider'; import { shortAddr } from '@/lib/api';`, inside the component `const { address, status, signIn } = useSession();`, and change `generate` and the button:

```js
  const generate = async () => {
    setSubmitErr(null); setSubmitting(true); setJob(null);
    try {
      if (!address) await signIn();                       // the provider stores the session; the API client picks it up
      const r = await contracts.register(addr.trim(), net, name.trim() || undefined);
      setJob({ id: r.id, status: r.status, steps: r.steps });
    }
    catch (e) { if (e?.name !== 'WalletError' || e.code !== 'rejected') setSubmitErr(e); }
    finally { setSubmitting(false); }
  };
```

```jsx
          <S.Button arrow disabled={!valid || submitting || status === 'signing'} onClick={generate}>{submitting ? 'Submitting…' : address ? 'Generate' : 'Connect wallet to register'}</S.Button>
```

and below the existing `network_not_configured` note add:

```jsx
        {submitErr && submitErr.error === 'not_owner' && (
          <div className="sn-small sn-muted">This contract was registered by another wallet ({shortAddr(submitErr.details?.owner)}). Only that wallet can refresh or change it.</div>
        )}
        {submitErr && submitErr.error === 'unauthorized' && (
          <div className="sn-small sn-muted">Your session expired — connect your wallet again.</div>
        )}
```

The field hint stays `submitErr.message` for other errors. The `Field` hint for `not_owner` should not repeat the message: set `const fieldHint = submitErr && !['not_owner', 'unauthorized'].includes(submitErr.error) ? submitErr.message : '56 characters, starts with C';`.

`components/screens/Contracts.jsx` — `import { useSession } from '@/components/SessionProvider';`; `const { address, status, signIn } = useSession();`; fetch only when signed in: `const { data, error, loading, refetch } = useApi((signal) => (address ? contracts.list({ mine: true, signal }) : Promise.resolve(null)), [address]);`. When `!address`, render instead of the `Async` block:

```jsx
        <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '32px 0' }}>
          <div className="sn-body" style={{ fontWeight: 700 }}>Connect your wallet to see the contracts you registered.</div>
          <div className="sn-small sn-muted" style={{ marginTop: 8 }}>Anyone can use a registered contract; only the wallet that registered it can change its settings. <Link className="crumb" href="/explorer">Browse all contracts</Link>.</div>
          <div style={{ marginTop: 16 }}><S.Button arrow disabled={status === 'signing'} onClick={() => signIn().catch(() => {})}>{status === 'signing' ? 'Waiting for wallet…' : 'Connect wallet'}</S.Button></div>
        </div>
```

Keep the header ("My contracts", count only when `data`), the "Add a contract" button, the empty state ("No contracts yet") and the card grid as they are.

- [ ] **Step 4: Run, commit**

Run: `npm test` → PASS.

```bash
git add components/screens/Register.jsx components/screens/Contracts.jsx test/site/register.test.jsx
git commit -m "site: wallet-gated register, my-contracts list" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: workspace — owner controls, Sign & submit, honest History

**Files:**
- Modify: `components/workspace/Workspace.jsx`, `components/workspace/Overview.jsx`, `components/workspace/Mcp.jsx`, `components/workspace/Functions.jsx`, `components/workspace/History.jsx`
- Create: `test/site/functions-sign.test.jsx`, `test/site/history.test.jsx`

**Interfaces:**
- Consumes: `useSession`, `wallet.signTransaction`, `contracts.submit`, `PASSPHRASES`.
- Produces: tab bodies receive `isOwner` (boolean) in addition to `S, contract, id, refetch`.

- [ ] **Step 1: Failing tests**

`test/site/history.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import History from '@/components/workspace/History';

describe('History tab', () => {
  it('is an honest empty state with no sample rows', () => {
    render(<History S={{}} contract={{ id: 'C', events: [] }} id="C" />);
    expect(screen.getByText("History isn't live yet.")).toBeTruthy();
    expect(screen.getByText(/history provider in a later release/)).toBeTruthy();
    expect(screen.queryByText(/GBX7/)).toBeNull();
    expect(screen.queryByText(/Preview build/)).toBeNull();
  });
});
```

`test/site/functions-sign.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('@/lib/wallet', () => ({ signTransaction: vi.fn().mockResolvedValue('SIGNED') }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { ...(await orig()).contracts, tx: vi.fn(), submit: vi.fn(), call: vi.fn() } }));
import Functions from '@/components/workspace/Functions';
import { SessionProvider } from '@/components/SessionProvider';
import { setSession } from '@/lib/session';
import { contracts, PASSPHRASES } from '@/lib/api';
import * as wallet from '@/lib/wallet';

const S = {
  Button: ({ children, onClick, disabled }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  Field: ({ label, value, onChange }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /></label>,
  Segmented: ({ options, value, onChange }) => <div>{options.map((o) => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>,
  Numeral: () => null, Chip: ({ children }) => <span>{children}</span>, KeyValueList: ({ rows }) => <dl>{rows.map((r) => <div key={r.key}>{r.key}: {typeof r.value === 'string' ? r.value : ''}</div>)}</dl>
};
const contract = { id: 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP', network: 'testnet', functions: [{ name: 'bump', doc: '', inputs: [], output: 'u32', kind: 'unknown', jsonSchema: { type: 'object', properties: {}, required: [] } }] };
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('Functions: Sign & submit', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
  it('labels unknown kinds "Unknown" and hides Sign & submit when anonymous', () => {
    render(<SessionProvider><Functions S={S} contract={contract} id={contract.id} /></SessionProvider>);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Build transaction' }));
    expect(screen.queryByRole('button', { name: 'Sign & submit' })).toBeNull();
  });
  it('signed in: prefills source, builds, signs with the wallet and submits', async () => {
    setSession({ token: 't', address: G, expires_at: new Date(Date.now() + 60_000).toISOString() });
    contracts.tx.mockResolvedValue({ xdr: 'AAAA', fee: '100', auth: [G], ledger: 1, expires_at: new Date().toISOString() });
    contracts.submit.mockResolvedValue({ hash: 'abc123', status: 'success', ledger: 4745473 });
    render(<SessionProvider><Functions S={S} contract={contract} id={contract.id} /></SessionProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Build transaction' }));
    await waitFor(() => expect(screen.getByLabelText('source').value).toBe(G));
    fireEvent.click(screen.getByRole('button', { name: 'Sign & submit' }));
    await waitFor(() => expect(contracts.submit).toHaveBeenCalledWith(contract.id, 'SIGNED'));
    expect(wallet.signTransaction).toHaveBeenCalledWith('AAAA', PASSPHRASES.testnet, G);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeTruthy());
    expect(screen.getByText(/4745473/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npm test -- test/site/history.test.jsx test/site/functions-sign.test.jsx` → FAIL.

- [ ] **Step 3: History**

Replace `components/workspace/History.jsx` with:

```jsx
'use client';
import Link from 'next/link';

/** M4 brings a history provider; until then this tab says so instead of showing invented rows. */
export default function History() {
  return (
    <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '32px 0', maxWidth: 640 }}>
      <div className="sn-body" style={{ fontWeight: 700 }}>History isn&apos;t live yet.</div>
      <div className="sn-small sn-muted" style={{ marginTop: 8 }}>Decoded events and calls arrive with a history provider in a later release. Reads, simulation, transaction building and MCP tools already work — see the <Link className="crumb" href="/docs/api">REST API docs</Link>.</div>
    </div>
  );
}
```

- [ ] **Step 4: Workspace + Overview + Mcp**

`components/workspace/Workspace.jsx`:
- `import { useSession } from '@/components/SessionProvider'; import { shortAddr } from '@/lib/api';`
- inside the component: `const { address } = useSession(); const isOwner = !!address && !!contract && contract.owner === address; const unclaimed = !!contract && !contract.owner;`
- the title block: render the `Rename` button only when `isOwner`; after the network chip add `{!isOwner && <S.Chip tone="neutral">{unclaimed ? 'Unclaimed' : `Owned by ${shortAddr(contract.owner)}`}</S.Chip>}`.
- pass `isOwner` to the body: `<Body key={id} S={S} contract={contract} id={id} refetch={refetch} isOwner={isOwner} />`.

`components/workspace/Overview.jsx`: History surface row becomes `{ name: 'History', d: 'coming soon · decoded events and calls', href: `/c/${id}/history`, soon: true }` and the chip renders `{s.soon && <> <S.Chip tone="neutral">soon</S.Chip></>}` (rename the `preview` flag).

`components/workspace/Mcp.jsx`: accept `isOwner`; when `!isOwner` render, instead of the Segmented control, `<S.Chip tone={rw ? 'inverse' : 'neutral'}>{rw ? 'Read + write' : 'Read only'}</S.Chip>` and the helper text `Only the wallet that registered this contract can change the scope.`; keep everything else.

- [ ] **Step 5: Functions**

In `components/workspace/Functions.jsx`:
- imports: `import * as wallet from '@/lib/wallet'; import { contracts, isAccountId, PASSPHRASES } from '@/lib/api'; import { useSession } from '@/components/SessionProvider';`
- `kindChip`: the unknown branch renders `<S.Chip tone="neutral">Unknown</S.Chip>`; the detail label reads `Function detail · {fn.kind === 'unknown' ? 'unknown (classified on first simulation)' : fn.kind}`.
- inside the component: `const { address } = useSession();` and `useEffect(() => { if (mode === 'build' && address && !source) setSource(address); }, [mode, address]);`
- add the handler next to `run`:

```js
  const signAndSubmit = async () => {
    const { args, errors: e } = coerceArgs(inputs, values);
    if (!isAccountId(source.trim())) e.source = 'A G… account address is required to build a transaction';
    setErrors(e); setOut(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const built = await contracts.tx(id, fn.name, args, source.trim());
      setOut({ kind: 'build', body: built });
      const signed = await wallet.signTransaction(built.xdr, PASSPHRASES[c.network], source.trim());
      setOut({ kind: 'submitted', body: { ...(await contracts.submit(id, signed)), xdr: built.xdr } });
    } catch (err) {
      if (err?.name === 'WalletError') setOut({ kind: 'error', body: { message: err.code === 'network' ? `Switch your wallet to ${c.network} and try again.` : err.message, error: `wallet_${err.code}` } });
      else { if (err.error === 'invalid_args' && err.details?.path) setErrors({ [String(err.details.path).split(/[.[]/)[0]]: err.message }); setOut({ kind: 'error', body: err }); }
    } finally { setBusy(false); }
  };
```

- the button row: after the existing button add `{mode === 'build' && address && <S.Button variant="secondary" disabled={busy} onClick={signAndSubmit}>Sign &amp; submit</S.Button>}`.
- results: add a `submitted` block before the `error` block:

```jsx
            {out?.kind === 'submitted' && (
              <>
                <Label>Submitted</Label>
                <div style={{ marginTop: 14 }}>
                  <S.KeyValueList rows={[
                    { key: 'Status', value: out.body.status, mono: false },
                    { key: 'Hash', value: out.body.hash },
                    { key: 'Ledger', value: out.body.ledger !== undefined ? String(out.body.ledger) : '—' },
                    ...(out.body.fee_charged ? [{ key: 'Fee charged', value: `${out.body.fee_charged} stroops` }] : [])
                  ]} />
                </div>
              </>
            )}
```

- the helper line under Download XDR becomes `Sign it here with your connected wallet, or with any Stellar signer and <span className="sn-mono">POST {contracts.urls(id).base}/submit</span>.`

- [ ] **Step 6: Run, commit**

Run: `npm test` → PASS; `npm run build` → OK.

```bash
git add components/workspace test/site/history.test.jsx test/site/functions-sign.test.jsx
git commit -m "site: owner-gated workspace controls, Sign & submit, honest History tab" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: real Explorer, real Home, public page cleanup, delete the fake modules

**Files:**
- Modify: `components/screens/Explorer.jsx`, `components/screens/Welcome.jsx`, `components/screens/ContractPublic.jsx`, `app/explorer/[id]/page.jsx`, `components/data.js`, `components/seo.js`, `components/SiteFooter.jsx`, `README.md`
- Delete: `app/flows/page.jsx`, `app/flows/[slug]/page.jsx`, `app/keys/page.jsx`, `components/screens/Flows.jsx`, `components/screens/FlowDetail.jsx`, `components/screens/Keys.jsx`, `components/flows-data.js`, `components/explorer-data.js`, `components/home-data.js`, `components/PreviewBar.jsx`
- Create: `test/site/explorer.test.jsx`

- [ ] **Step 1: Failing test**

`test/site/explorer.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/sonata', () => ({ useSonataUI: () => ({
  Button: ({ children, onClick }) => <button onClick={onClick}>{children}</button>,
  Field: ({ label, value, onChange }) => <label>{label}<input aria-label={label} value={value || ''} onChange={onChange} /></label>,
  Segmented: ({ options, value, onChange }) => <div>{options.map((o) => <button key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>,
  Numeral: () => null, Chip: ({ children }) => <span>{children}</span>
}) }));
vi.mock('@/lib/api', async (orig) => ({ ...(await orig()), contracts: { ...(await orig()).contracts, list: vi.fn() } }));
import Explorer from '@/components/screens/Explorer';
import { contracts } from '@/lib/api';

const rows = [
  { id: 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH', name: 'Soroswap Router', network: 'mainnet', status: 'ready', fns: 20, owner: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', created_at: '2026-09-18T16:00:00Z', updated_at: '2026-09-18T16:00:00Z' },
  { id: 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP', name: 'e2e fixture', network: 'testnet', status: 'ready', fns: 15, owner: null, created_at: '2026-09-18T15:00:00Z', updated_at: '2026-09-18T15:00:00Z' },
  { id: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', name: null, network: 'testnet', status: 'failed', fns: 0, owner: null, created_at: '2026-09-18T14:00:00Z', updated_at: '2026-09-18T14:00:00Z' }
];

describe('Explorer', () => {
  it('lists ready contracts from the API, filters by network and search', async () => {
    contracts.list.mockResolvedValue(rows);
    render(<Explorer />);
    await waitFor(() => screen.getByText('Soroswap Router'));
    expect(screen.getByText('e2e fixture')).toBeTruthy();
    expect(screen.queryByText(/CDLZ/)).toBeNull();                       // failed rows are not listed
    fireEvent.click(screen.getByRole('button', { name: 'Mainnet' }));
    expect(screen.queryByText('e2e fixture')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'fixture' } });
    expect(screen.queryByText('Soroswap Router')).toBeNull();
    expect(screen.getByText('e2e fixture')).toBeTruthy();
  });
  it('shows an empty state when nothing is registered', async () => {
    contracts.list.mockResolvedValue([]);
    render(<Explorer />);
    await waitFor(() => screen.getByText('No contracts registered yet.'));
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- test/site/explorer.test.jsx` → FAIL (renders sample data).

- [ ] **Step 3: Explorer**

Replace `components/screens/Explorer.jsx` with:

```jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label } from '@/components/ui';
import { contracts, shortId, shortAddr, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';

const NETS = [{ value: 'all', label: 'All' }, { value: 'testnet', label: 'Testnet' }, { value: 'mainnet', label: 'Mainnet' }];
const SORTS = [{ value: 'updated', label: 'Recently updated' }, { value: 'name', label: 'Name' }];
const label = (c) => c.name || shortId(c.id);

export default function Explorer() {
  const S = useSonataUI();
  const router = useRouter();
  const [net, setNet] = useState('all');
  const [sort, setSort] = useState('updated');
  const [q, setQ] = useState('');
  const { data, error, loading, refetch } = useApi((signal) => contracts.list({ signal }), []);
  if (!S) return null;
  const query = q.trim().toLowerCase();
  const all = (data || []).filter((c) => c.status === 'ready');
  const list = all
    .filter((c) => (net === 'all' || c.network === net) && (!query || label(c).toLowerCase().includes(query) || c.id.toLowerCase().includes(query)))
    .sort((a, b) => (sort === 'name' ? label(a).localeCompare(label(b)) : b.updated_at.localeCompare(a.updated_at)));
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="sn-h1">Contract explorer</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 12, maxWidth: 560 }}>Every Soroban contract registered with Sonata. Each one has a hosted REST API, MCP tools and docs you can use without registering anything yourself.</p>
        </div>
        <span className="sn-label sn-muted">{data ? `${all.length} contracts` : ''}</span>
      </div>
      <div className="filters">
        <div className="filters__seg"><S.Segmented ariaLabel="Network" options={NETS} value={net} onChange={setNet} /></div>
        <div className="filters__seg"><S.Segmented ariaLabel="Sort" options={SORTS} value={sort} onChange={setSort} /></div>
        <div className="filters__addr"><S.Field label="Search" mono placeholder="Name or C…" hint="Name or contract ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {all.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-body" style={{ fontWeight: 700 }}>No contracts registered yet.</span></div>
        ) : list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}><span className="sn-small sn-muted">No contracts match. Try another network or search.</span></div>
        ) : (
          <div>
            <Label style={{ marginBottom: 16 }}>{list.length === all.length ? 'All contracts' : list.length + ' matching'}</Label>
            <div className="card-grid">
              {list.map((c, i) => (
                <Link key={c.id} className="card" href={'/explorer/' + c.id}>
                  <div className="card__top">
                    <S.Numeral index={i + 1} />
                    <div className="card__chips"><S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip></div>
                  </div>
                  <div className="sn-h3 card__title">{label(c)}</div>
                  <div className="sn-mono sn-muted card__id">{c.id}</div>
                  <div className="card__desc" />
                  <div className="card__inputs">
                    <div className="sn-label sn-muted">{c.fns} functions{c.owner ? ` · by ${shortAddr(c.owner)}` : ''}</div>
                    <div className="sn-mono card__names">updated {relTime(c.updated_at)}</div>
                  </div>
                  <div className="card__foot"><span className="sn-label">Open contract</span><span className="sn-mono">→</span></div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Async>
      <div className="cta-band">
        <div>
          <div className="sn-h3">Your contract is not here?</div>
          <div className="sn-body sn-muted" style={{ marginTop: 6 }}>Connect a wallet and register it — Sonata generates the API, MCP tools and docs in about thirty seconds.</div>
        </div>
        <div className="actions"><S.Button arrow onClick={() => router.push('/register')}>Register a contract</S.Button></div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Public page**

`components/screens/ContractPublic.jsx`: remove the imports of `PreviewBar` and `PUBLIC_FNS, fmt`; delete the whole `Demo` function; in `Live`, the kind chip unknown branch renders `Unknown`; change the signature to `export default function ContractPublic({ id })` (no `demo`), `const crumb = data ? (data.name || shortId(id)) : shortId(id);`, and in the body render `live ? <Live … /> : registering ? <Registering … /> : notFound ? <NotRegistered S={S} id={id} /> : null` inside the existing `Async` — i.e. remove every `demo` branch. Add an "Owner" row to the About list: `{ key: 'Owner', value: c.owner ? shortAddr(c.owner) : 'unclaimed', mono: !!c.owner }`.

`app/explorer/[id]/page.jsx`: remove the `CONTRACT_BY_ID` import and its `generateMetadata` fallback (unknown → `pageMeta({ title: 'Contract', path: '/explorer' })`), and render `<ContractPublic id={id} />`.

- [ ] **Step 5: Home**

Replace `components/screens/Welcome.jsx` with a data-driven version. Keep the existing section markup/classes (hero with `S.StaffLines`, `.sn-stat-row`, `.steps`, `.surfaces`, `.two-col` code blocks, the footer CTA band) but:

```jsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { Label, CodeBox, CopyButton } from '@/components/ui';
import { contracts, health, mcpToolCount, shortId, API_URL } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { mcpConfig } from '@/components/workspace/Mcp';

const PRE = { margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const ROWS = [
  { name: 'REST API', d: 'Every contract function becomes an HTTP endpoint: simulate reads, build unsigned transactions, submit signed ones.' },
  { name: 'MCP server', d: 'Typed tools any AI agent can call — read-only by default, read + write when the owner enables it.' },
  { name: 'AI-ready docs', d: 'llms.txt and OpenAPI 3.1 generated from the contract spec.' }
];
const STEPS = [
  { name: 'Connect and register', d: 'Connect a Stellar wallet, paste a Soroban contract ID. Sonata reads the SEP-48 spec from the network.' },
  { name: 'Generate surfaces', d: 'REST endpoints, an MCP server and docs are published under one URL in about thirty seconds.' },
  { name: 'Connect apps + agents', d: 'Backends, Claude, Cursor and autonomous agents call the contract over plain HTTP; your wallet signs in the browser.' }
];
const SURFACES = [
  { audience: 'Backend teams', name: 'Hosted REST API', d: 'Call any function with JSON. Sonata handles XDR encoding, simulation and fee estimation.', endpoint: 'POST /c/{contractId}/call/{fn}' },
  { audience: 'AI agents', name: 'MCP server', d: 'Search, docs, reads, simulation and transaction building exposed as tools.', endpoint: '/c/{contractId}/mcp' },
  { audience: 'Context windows', name: 'AI-ready docs', d: 'A compact llms.txt generated from the contract spec.', endpoint: 'GET /c/{contractId}/llms.txt' }
];
const firstRead = (c) => (c.functions || []).find((f) => f.kind === 'read') || (c.functions || [])[0];

export default function Welcome() {
  const S = useSonataUI();
  const router = useRouter();
  const list = useApi((signal) => contracts.list({ signal }), []);
  const hz = useApi((signal) => health({ signal }), []);
  const ready = (list.data || []).filter((c) => c.status === 'ready');
  const example = ready[0] ? ready[0] : null;                       // the list is newest-updated first
  const detail = useApi((signal) => (example ? contracts.get(example.id, { signal }) : Promise.resolve(null)), [example?.id]);
  if (!S) return null;
  const fns = ready.reduce((n, c) => n + c.fns, 0);
  const networks = hz.data ? Object.keys(hz.data.networks || {}).length : null;
  const stats = [
    { label: 'Contracts registered', value: list.data ? String(ready.length) : '—' },
    { label: 'Functions exposed', value: list.data ? fns.toLocaleString('en-US') : '—' },
    { label: 'MCP tools', value: list.data ? ready.reduce((n, c) => n + c.fns + 2, 0).toLocaleString('en-US') : '—', note: 'read-only scope' },
    { label: 'Networks live', value: networks === null ? '—' : String(networks), note: hz.data ? Object.keys(hz.data.networks).join(' · ') : '' }
  ];
  const ex = detail.data;
  const fn = ex ? firstRead(ex) : null;
  const curl = ex && fn
    ? `curl -X POST "${API_URL}/c/${ex.id}/call/${fn.name}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "args": {} }'\n\n# ${ex.name || shortId(ex.id)} · ${ex.network} · ${ex.functions.length} functions`
    : `curl -X POST "${API_URL}/c/{contractId}/call/{fn}" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "args": {} }'`;
  const mcp = ex ? `${mcpConfig(ex)}\n\n# or\nclaude mcp add --transport http sonata ${ex.urls.mcp}` : `claude mcp add --transport http sonata ${API_URL}/c/{contractId}/mcp`;
  return (
    <main className="home">
      {/* hero: same markup as before, with the copy below */}
      …h1: "API and MCP layer for Stellar contracts."
      …p: "REST endpoints, an MCP server and AI-ready docs for any Soroban contract, in about thirty seconds. No backend, no SDK, no custody."
      …CTAs: <S.Button size="lg" arrow onClick={() => router.push('/register')}>Register a contract</S.Button> and <S.Button size="lg" variant="secondary" onClick={() => router.push('/explorer')}>Browse contracts</S.Button>
      …small line: "Non-custodial · your wallet signs · Testnet & Mainnet · <Link href="/docs">Read the docs</Link>"
      …hero rows from ROWS; stats from `stats` (S.Stat label/value/note); steps from STEPS; surfaces from SURFACES; code blocks show `curl` and `mcp` with CopyButtons; keep the "MCP docs →" link and the closing CTA band.
    </main>
  );
}
```

The "…" lines are instructions, not literal code: reuse the existing JSX from the current `Welcome.jsx` for those sections (they are pure markup), swapping the data sources as described. Nothing on the page may reference `WELCOME_ROWS`, `HOME_*`, `CONTRACT_ID` or `PreviewBar`.

- [ ] **Step 6: Deletions, data.js, footer, seo, README**

```bash
git rm -r app/flows app/keys components/screens/Flows.jsx components/screens/FlowDetail.jsx components/screens/Keys.jsx components/flows-data.js components/explorer-data.js components/home-data.js components/PreviewBar.jsx
```

`components/data.js` becomes exactly:

```js
export const SITE_URL = 'https://sonata.brages.uk';
export const TAB_LABEL = { overview: 'Overview', functions: 'Functions', mcp: 'MCP', docs: 'Docs', history: 'History' };
export const NET_OPTS = [{ value: 'testnet', label: 'Testnet' }, { value: 'mainnet', label: 'Mainnet' }];
```

`components/SiteFooter.jsx`: drop the Flows link. `components/seo.js`: `SITE_DESCRIPTION = 'Paste a Soroban contract ID and get a hosted REST API, an MCP server for AI agents and AI-ready docs in about thirty seconds. No backend, no SDK, no custody.'`. `README.md`: routes list without `/flows` and `/keys`; the "Notes" bullet about demo data becomes "History is an empty state until the history milestone; everything else is live data from the API."

Then `grep -rn "PreviewBar\|explorer-data\|flows-data\|home-data\|WELCOME_ROWS\|DEMO_API_URL\|CONTRACT_ID\|HIST_OPTS" app components lib` must print nothing except `docs-data.js` (rewritten in Task 12).

- [ ] **Step 7: Run, build, commit**

Run: `npm test` → PASS. `npm run build` → OK (no `/flows`, `/keys` routes in the output; `docs-data.js` still imports from `./data` — temporarily keep a `DEMO_API_URL`, `CONTRACT_ID`, `MCP_URL`, `MCP_CONFIG`, `LLMS` shim **only if** the build fails, and remove it in Task 12; prefer doing Task 12 immediately after).

```bash
git add -A app components lib README.md test/site/explorer.test.jsx
git commit -m "site: real explorer and home, public page without demo fallback, delete flows/keys/sample data" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: docs rewrite, Playwright e2e with a real session

**Files:**
- Modify: `components/docs-data.js` (whole file), `playwright.config.js`, `e2e/site.spec.ts`, `package.json` (devDependency `@stellar/stellar-sdk`)

- [ ] **Step 1: Docs**

Replace `components/docs-data.js` with five pages built from `API_URL` (`import { API_URL } from '@/lib/api';`; no sample constants). Required content, page by page (block types stay `p | code | list | kv`):

1. `overview` — "What you get": list = REST API for every function (simulate + unsigned XDR + submit), MCP server per contract, llms.txt + OpenAPI 3.1. "How it fits together": kv Base URL = `API_URL`, Contract path `/c/{contractId}`, Networks `testnet · mainnet`, Auth "Reads are public; registering and settings need a wallet session". "Ownership": p = the wallet that registers a contract owns it (rename, MCP scope, refresh); anyone can read, simulate, build and submit. "History": p = "History (decoded events and calls) is not live yet; it arrives with a history provider in a later release."
2. `quickstart` — 1. Connect a wallet (Freighter, xBull, Albedo, Lobstr) · 2. Register (paste id, pick network, Generate) · 3. Read: code `curl -X POST "${API_URL}/c/{contractId}/call/{fn}" -H "Content-Type: application/json" -d '{ "args": { … } }'` with the response shape `{ "result": …, "simulated": true, "latency_ms": 42, "ledger": 123, "auth": [] }` · 4. Write: build with `/tx/{fn}` (body `{ "args": …, "source": "G…" }` → `{ "xdr", "fee", "auth", "ledger", "expires_at" }`), sign with the connected wallet (Sign & submit) or any signer, `POST /c/{contractId}/submit { "xdr" }`.
3. `api` — kv of endpoints: `POST /auth/challenge` `{address, network}` → challenge; `POST /auth/token` `{transaction, network}` → `{token, address, expires_at}`; `GET /auth/me`; `POST /contracts` (session; owner) ; `GET /contracts` (+ `?owner=me`); `GET /c/{id}`, `/status`; `PATCH /c/{id}` (owner); `POST /c/{id}/call/{fn}`; `POST /c/{id}/tx/{fn}`; `POST /c/{id}/submit`; `GET /tx/{hash}?network=`; `GET /c/{id}/llms.txt`; `GET /c/{id}/openapi.json`; `GET /healthz`. "Request body" (args by name; ≥64-bit ints as decimal strings, bytes as 0x-hex, maps as objects, enums as integers, unions as `"Name"` or `{tag, values}`). "Responses" code block with the read/write/error shapes (error envelope `{ "error", "message", "code?", "details?" }`). "Authentication and limits": p = SEP-10-style challenge signed by the wallet → 24 h bearer token; 120 requests/min per IP; `sac_unsupported` for Stellar Asset Contracts.
4. `mcp` — Connect: code = `{ "mcpServers": { "sonata-<name>": { "url": "${API_URL}/c/{contractId}/mcp", "type": "http" } } }` and the `claude mcp add --transport http …` one-liner. Tools kv: `search_functions`, `get_docs`, `call_{fn}`, `build_{fn}` (rw), `submit_transaction` (rw). p = write tools stay disabled until the owner switches the scope; agents never hold keys.
5. `llms` — Example: the first ~25 lines of the e2e fixture's real output. Fetch it while implementing: `curl -s https://api.sonata.brages.uk/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/llms.txt | head -25` and paste verbatim into the code block. Regeneration: p = docs regenerate on every registration and rename.

Nothing may mention `/events`, `/flows`, API keys, "preview", "sample data" or "indexed history". `DOC_BY_SLUG`/`DOCS` exports stay; `app/docs/[slug]/page.jsx` keeps working.

- [ ] **Step 2: Playwright**

`npm i -D @stellar/stellar-sdk@^17` (test-only: it signs the challenge).

`playwright.config.js` — load `server/.env.test` when present (same regex as the server e2e), before `defineConfig`:

```js
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('server/.env.test')) for (const l of readFileSync('server/.env.test', 'utf8').split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
```

`e2e/site.spec.ts` — replace the file:

```ts
import { test, expect } from '@playwright/test';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

const ID = process.env.E2E_CONTRACT_ID || 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const API = process.env.E2E_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const SECRET = process.env.E2E_SECRET_KEY || '';
const PASSPHRASES = { testnet: 'Test SDF Network ; September 2015', mainnet: 'Public Global Stellar Network ; September 2015' };

test.skip(!SECRET, 'needs E2E_SECRET_KEY (server/.env.test) to sign the wallet challenge');

/** The real challenge flow, signed here instead of by a wallet extension. */
async function session(request: any) {
  const kp = Keypair.fromSecret(SECRET);
  const ch = await (await request.post(`${API}/auth/challenge`, { data: { address: kp.publicKey(), network: 'testnet' } })).json();
  const tx = TransactionBuilder.fromXDR(ch.transaction, PASSPHRASES.testnet); tx.sign(kp);
  const t = await (await request.post(`${API}/auth/token`, { data: { transaction: tx.toXDR(), network: 'testnet' } })).json();
  return { token: t.token as string, address: kp.publicKey(), expires_at: t.expires_at as string };
}

test.afterEach(async ({ request }) => {
  const s = await session(request);
  await request.patch(`${API}/c/${ID}`, { data: { mcp_scope: 'ro' }, headers: { authorization: `Bearer ${s.token}` } });
});

test('owner: register → workspace controls → rename → scope → simulate → build → docs → explorer → public page', async ({ page, request }) => {
  const s = await session(request);
  await page.addInitScript((sess) => localStorage.setItem('sonata.session', JSON.stringify(sess)), s);
  await page.goto(`/register?id=${ID}`);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByRole('button', { name: 'Open contract workspace' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Open contract workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ID}/overview`));
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();

  const fnTab = page.getByRole('tab', { name: /Functions/ });
  const n = Number((await fnTab.locator('.sn-tabs__count').innerText()).trim());
  expect(n).toBeGreaterThan(0);
  await fnTab.click();
  await page.getByRole('button', { name: 'add', exact: true }).click();
  await page.getByLabel('a', { exact: true }).fill('5');
  await page.getByLabel('b', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText('"12"')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await page.getByRole('radio', { name: 'Build transaction' }).click();
  await expect(page.getByLabel('source', { exact: true })).toHaveValue(s.address);   // prefilled from the session
  await expect(page.getByRole('button', { name: 'Sign & submit' })).toBeVisible();     // not clicked: no wallet extension here
  await page.getByLabel('who', { exact: true }).fill(s.address);
  await page.getByLabel('n', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Build unsigned XDR' }).click();
  await expect(page.getByText('Unsigned XDR', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('tab', { name: /MCP/ }).click();
  await page.getByRole('radio', { name: 'Read + write' }).click();
  await expect(page.getByText(`Tools · ${n * 2 + 3} enabled`)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByText("History isn't live yet.")).toBeVisible();

  await page.goto('/explorer');
  await expect(page.getByText(ID)).toBeVisible({ timeout: 15_000 });
  await page.goto(`/explorer/${ID}`);
  await expect(page.getByText(`/c/${ID}/mcp`)).toBeVisible();
  await expect(page.getByText(`Functions · ${n}`)).toBeVisible();
});

test('anonymous: no owner controls, register asks for a wallet', async ({ page }) => {
  await page.goto(`/c/${ID}/overview`);
  await expect(page.getByText(/Owned by|Unclaimed/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Rename' })).toHaveCount(0);
  await page.goto(`/register?id=${ID}`);
  await expect(page.getByRole('button', { name: 'Connect wallet to register' })).toBeVisible();
  await page.goto('/flows');
  await expect(page.getByText(/404|could not be found/i)).toBeVisible();
});
```

- [ ] **Step 3: Run the site suites**

Run: `npm test && npm run build` → PASS/OK. With the API running locally against a DB (`cd server && npm run dev`) and the site (`npm run dev`): `npm run test:e2e` → both tests PASS (the first re-registers the fixture with the e2e wallet as owner; if the fixture is already owned by another address on that API, the test fails with `not_owner` — use a fresh local DB).

- [ ] **Step 4: Commit**

```bash
git add components/docs-data.js playwright.config.js e2e/site.spec.ts package.json package-lock.json
git commit -m "site: docs rewritten to the real API, Playwright signs in with the fixture key" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: deploy, claim legacy contracts, verify on production

**Files:** none (operations). Do this task only after the whole-branch review passes.

- [ ] **Step 1: Ship**

```bash
git push origin main            # Dokploy autodeploys the API (server/** changed); watch Deployments in the panel or poll:
for i in $(seq 1 40); do curl -s https://api.sonata.brages.uk/auth/me -o /dev/null -w "%{http_code}\n" | grep -q 401 && break; sleep 10; done   # 401 (not 404) means the new API is live
vercel deploy --prod --yes      # site
```

- [ ] **Step 2: Smoke the API**

```bash
API=https://api.sonata.brages.uk
curl -s -X POST $API/auth/challenge -H 'content-type: application/json' -d '{"address":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF","network":"testnet"}' | head -c 200   # → {"transaction":"AAAA…","network_passphrase":"Test SDF…"}
curl -s -X POST $API/contracts -H 'content-type: application/json' -d '{"id":"CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP","network":"testnet"}' -w " %{http_code}\n"   # → 401 unauthorized
curl -s $API/contracts | head -c 400      # items now carry owner (null for the four legacy rows) and created_at
```

- [ ] **Step 3: Production e2e + legacy claim**

```bash
SITE_URL=https://sonata.brages.uk E2E_API_URL=https://api.sonata.brages.uk npm run test:e2e
```

This claims the testnet fixture for the e2e wallet. The three mainnet contracts (Soroswap Router, Blend Backstop, Blend Pool Factory) stay `owner: null` until the user opens https://sonata.brages.uk/register?id=<id> with their wallet and clicks Generate — do that for each, or leave them unclaimed (they remain fully usable).

- [ ] **Step 4: Browser check with a real wallet (user)**

On https://sonata.brages.uk: Connect wallet → sign the challenge → Register a contract → workspace shows Rename + scope controls → Functions → Build transaction → Sign & submit → hash shown. Home shows live counts; Explorer lists the registered contracts; `/flows` and `/keys` are 404; History tab shows the empty state; footer has no preview line.

---

## Self-review

- **Spec coverage:** §2 ownership → Tasks 1, 4; §3 auth → Tasks 2, 3; §4 hardening (SAC, list shape, migration) → Tasks 1, 4, 5; §5.1 wallet/session/nav → Tasks 6–8; §5.2 screens (Home, Explorer, public, Register, My contracts, Workspace incl. Sign & submit/Unknown/History, Docs, deletions, footer/nav/seo/README) → Tasks 9–12; §6 error handling → Tasks 4, 6, 8, 9, 10; §7 testing → every task carries its tests, server e2e in Task 4, Playwright in Task 12; §8 deployment → Task 13.
- **Placeholder scan:** the only intentionally non-literal block is the Home hero markup in Task 11 Step 5 (explicitly "reuse the existing JSX"); every other code step is complete.
- **Type/name consistency:** `Store.upsertQueued(id, network, name, owner)` and `Registry.register(id, network, name, owner)` (Task 1) are what Task 4 calls; `signInAs`/`bearer`/`OWNER` (Task 3 helper) are what Tasks 4–5 import; `PASSPHRASES`, `shortAddr`, `health`, `auth`, `contracts.submit`, `contracts.list({ mine })` (Task 6) are what Tasks 7–11 use; `useSession()` fields (Task 8) match their use in Tasks 9–10; `WalletError.code` values (Task 7) match the checks in Tasks 9–10.
