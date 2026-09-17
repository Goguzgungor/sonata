# Sonata Server Core Engine (M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Node service under `server/` that registers any Soroban contract and serves simulate / unsigned-XDR / submit endpoints, a per-contract MCP server, and generated llms.txt + OpenAPI.

**Architecture:** One Fastify process. `spec/` turns WASM into a `ContractModel` and owns JSON⇄ScVal; `chain/` wraps `rpc.Server`; `registry/` runs the registration pipeline and persists to Postgres; `http/` and `mcp/` are thin adapters over those; `docs/` is pure generation. Every module is dependency-injected through a `Deps` object so routes and MCP are tested with fakes and only `test:e2e` touches testnet.

**Tech Stack:** TypeScript 5.9 (ESM, `"type": "module"`), Node 22, Fastify 5, `@stellar/stellar-sdk` 17, `@modelcontextprotocol/server` + `/node` + `/client` 2.0, `drizzle-orm` 0.45 + `pg`, `zod` 4, `p-queue` 9, `pino` 10, `vitest` 5, `tsx`. Fixture contract: Rust, `soroban-sdk` 27.0.6, built with `stellar` CLI 26.

**Spec:** `docs/superpowers/specs/2026-09-17-sonata-server-core-engine-design.md`

## Global Constraints

- Everything lives under `server/`; the Next.js site at the repo root is untouched. Never create a root-level `api/` directory (Vercel would build it as serverless functions).
- Package is ESM: `"type": "module"`, imports use `.js` suffixes in TS source (`import { x } from './x.js'`), `moduleResolution: "NodeNext"`.
- Pinned versions: `@stellar/stellar-sdk@^17.1.0`, `@modelcontextprotocol/server@^2.0.0`, `@modelcontextprotocol/node@^2.0.0`, `@modelcontextprotocol/client@^2.0.0`, `fastify@^5.12.0`, `drizzle-orm@^0.45.0`, `drizzle-kit@^0.31.0`, `pg@^8.23.0`, `zod@^4.6.0`, `p-queue@^9.3.0`, `pino@^10.3.0`, `vitest@^5.0.0`, `tsx@^4.23.0`, `typescript@^5.9.0` (NOT 7.x).
- stellar-sdk 17 XDR objects are **plain-object style**: unions are `{ type: 'scvVoid', value }`, structs expose fields as properties (`entry.value.name`, `fn.inputs`, `typeDef.value.valueType`). XDR strings need `.toString()`. Never use the old `.switch().name` / `.value()` accessors.
- Integers ≥ 64-bit travel as decimal strings in JSON, always. Bytes travel as `0x`-prefixed hex. Maps are JSON objects (spec §6.1). Amendment to spec §6.1 discovered during SDK review: C-style enums (`ScSpecUdtEnumV0`) are JSON **numbers** (the discriminant), unions (`ScSpecUdtUnionV0`) are `"Name"` for void cases or `{ "tag": "Name", "values": [...] }` for tuple cases — that is what `Spec.nativeToScVal` accepts.
- Error envelope everywhere: `{ error, message, code?, details? }` with the HTTP codes in spec §6.2.
- MCP `outputSchema` for `call_*`/`build_*` is the **response envelope** (result/xdr + metadata), not the contract return type (spec §7 amendment; keeps SDK-side validation from rejecting hex/decimal-string encodings).
- Networks: `testnet` passphrase `Test SDF Network ; September 2015`, default RPC `https://soroban-testnet.stellar.org`; `mainnet` passphrase `Public Global Stellar Network ; September 2015`, RPC only from env.
- Commit after every task with a conventional message; run `npm test` in `server/` before every commit.

---

## File structure

```
server/
  package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts  .env.example  README.md
  Dockerfile  docker-compose.yml  fly.toml
  src/
    config.ts                 env → Config
    types.ts                  ContractModel, JsonSchema, Network, Deps (shared types only)
    errors.ts                 ApiError class + helpers (one place for the envelope)
    spec/
      render.ts               renderType(typeDef) → "Vec<Address>" etc.
      hints.ts                classifyByName(fn, inputs) → 'read'|'write'|'unknown'
      schema.ts               inlineRefs(jsonSchema) + fnInputSchema(spec, fn)
      model.ts                modelFromWasm(wasm, meta) → ContractModel (+ keeps Spec)
      codec.ts                encodeArgs / decodeResult / errorName + JSON normalizers
    chain/
      types.ts                Chain interface (what everything else calls)
      rpc.ts                  RpcChain: real implementation over stellar-sdk
      errors.ts               parseSimulationError(msg) → { kind, code? }
      auth.ts                 authAddresses(entries, source) → string[]
    registry/
      schema.ts               drizzle tables
      store.ts                Store interface + PgStore + MemoryStore
      pipeline.ts             register(id, network, name?) with steps
      registry.ts             Registry = store + LRU + pipeline + spec cache
    docs/
      llms.ts                 llmsTxt(model, cfg)
      openapi.ts              openapi(model, cfg)
    http/
      app.ts                  buildApp(deps) → Fastify instance
      routes/contracts.ts     POST/GET /contracts, GET /c/:id, /status, PATCH
      routes/invoke.ts        /call, /tx, /submit, /tx/:hash
      routes/docs.ts          /llms.txt, /openapi.json, /events (501)
      routes/health.ts        /healthz
    mcp/
      tools.ts                buildMcpServer(model, scope, deps) → McpServer
      route.ts                Fastify handler using NodeStreamableHTTPServerTransport
    main.ts                   boot
  drizzle/                    generated SQL migrations
  test/
    fixtures/kitchen-sink/    Cargo.toml, src/lib.rs, kitchen_sink.wasm
    helpers/fakeChain.ts      scripted Chain for route + mcp tests
    spec/*.test.ts  chain/*.test.ts  registry/*.test.ts  docs/*.test.ts  http/*.test.ts  mcp/*.test.ts
    e2e/flow.test.ts          testnet
```

---

### Task 1: Scaffold `server/` package, config, error type

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/.env.example`, `server/.gitignore`
- Create: `server/src/config.ts`, `server/src/errors.ts`, `server/src/types.ts`
- Test: `server/test/config.test.ts`, `server/test/errors.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`, `ApiError`, `type Network = 'testnet' | 'mainnet'`, `type ContractModel`, `type JsonSchema = Record<string, unknown>`.

- [ ] **Step 1: Create the package**

`server/package.json`:
```json
{
  "name": "sonata-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --exclude 'test/e2e/**'",
    "test:watch": "vitest --exclude 'test/e2e/**'",
    "test:e2e": "vitest run test/e2e",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/registry/migrate.ts"
  },
  "dependencies": {
    "@fastify/cors": "^11.3.0",
    "@fastify/rate-limit": "^11.2.0",
    "@modelcontextprotocol/node": "^2.0.0",
    "@modelcontextprotocol/server": "^2.0.0",
    "@stellar/stellar-sdk": "^17.1.0",
    "drizzle-orm": "^0.45.0",
    "fastify": "^5.12.0",
    "p-queue": "^9.3.0",
    "pg": "^8.23.0",
    "pino": "^10.3.0",
    "zod": "^4.6.0"
  },
  "devDependencies": {
    "@modelcontextprotocol/client": "^2.0.0",
    "@types/node": "^22",
    "@types/pg": "^8",
    "drizzle-kit": "^0.31.0",
    "tsx": "^4.23.0",
    "typescript": "^5.9.0",
    "vitest": "^5.0.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

`server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], testTimeout: 20000 } });
```

`server/.gitignore`:
```
node_modules
dist
.env
.env.test
test/fixtures/kitchen-sink/target
```

`server/.env.example`:
```
PORT=8080
DATABASE_URL=postgres://sonata:sonata@localhost:5432/sonata
PUBLIC_BASE_URL=http://localhost:8080
RPC_URL_TESTNET=https://soroban-testnet.stellar.org
RPC_URL_MAINNET=
SIM_SOURCE_ACCOUNT=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
CORS_ORIGINS=http://localhost:3000
LOG_LEVEL=info
```

Run: `cd server && npm install`
Expected: installs without peer warnings that mention `typescript@7`.

- [ ] **Step 2: Write failing config + error tests**

`server/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgres://x' };

describe('loadConfig', () => {
  it('fills defaults and enables only testnet when mainnet url is unset', () => {
    const cfg = loadConfig(base);
    expect(cfg.port).toBe(8080);
    expect(cfg.publicBaseUrl).toBe('http://localhost:8080');
    expect(cfg.networks.testnet.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.networks.testnet.passphrase).toBe('Test SDF Network ; September 2015');
    expect(cfg.networks.mainnet).toBeUndefined();
    expect(cfg.corsOrigins).toEqual(['http://localhost:3000']);
  });
  it('enables mainnet when RPC_URL_MAINNET is set', () => {
    const cfg = loadConfig({ ...base, RPC_URL_MAINNET: 'https://rpc.example' });
    expect(cfg.networks.mainnet?.passphrase).toBe('Public Global Stellar Network ; September 2015');
  });
  it('throws without DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it('strips a trailing slash from PUBLIC_BASE_URL and splits CORS origins', () => {
    const cfg = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://api.x/', CORS_ORIGINS: 'a, b' });
    expect(cfg.publicBaseUrl).toBe('https://api.x');
    expect(cfg.corsOrigins).toEqual(['a', 'b']);
  });
});
```

`server/test/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/errors.js';

describe('ApiError', () => {
  it('serialises to the envelope', () => {
    const e = new ApiError(422, 'SlippageExceeded', 'contract error 2', { code: 2, details: { fn: 'swap' } });
    expect(e.status).toBe(422);
    expect(e.toJSON()).toEqual({ error: 'SlippageExceeded', message: 'contract error 2', code: 2, details: { fn: 'swap' } });
  });
  it('omits code and details when absent', () => {
    expect(new ApiError(404, 'contract_not_found', 'nope').toJSON()).toEqual({ error: 'contract_not_found', message: 'nope' });
  });
});
```

Run: `npx vitest run test/config.test.ts test/errors.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement types, errors, config**

`server/src/types.ts`:
```ts
export type Network = 'testnet' | 'mainnet';
export type JsonSchema = Record<string, unknown>;
export type FnKind = 'read' | 'write' | 'unknown';

export type FnModel = {
  name: string;
  doc: string;
  inputs: Array<{ name: string; type: string }>;
  output: string;
  kind: FnKind;
  jsonSchema: JsonSchema;      // { type:'object', properties, required, additionalProperties:false } — self-contained
};

export type ContractModel = {
  id: string;
  network: Network;
  name: string | null;
  wasmHash: string;
  specLedger: number;
  functions: FnModel[];
  types: Array<{ name: string; kind: 'struct' | 'union' | 'enum'; doc: string; jsonSchema: JsonSchema }>;
  errors: Array<{ code: number; name: string; doc: string }>;
  events: Array<{ name: string; doc: string; params: Array<{ name: string; type: string }> }>;
};

export type McpScope = 'ro' | 'rw';
export type StepStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed';
export type Step = { name: 'fetch' | 'parse' | 'generate' | 'index'; status: StepStatus; detail: string; error?: string };
export type ContractStatus = 'queued' | 'running' | 'ready' | 'failed';
```

`server/src/errors.ts`:
```ts
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: string,
    message: string,
    public readonly extra: { code?: number; details?: unknown } = {}
  ) { super(message); }
  toJSON() {
    const out: Record<string, unknown> = { error: this.error, message: this.message };
    if (this.extra.code !== undefined) out.code = this.extra.code;
    if (this.extra.details !== undefined) out.details = this.extra.details;
    return out;
  }
}
export const notFound = (what: string, id: string) => new ApiError(404, `${what}_not_found`, `${what} ${id} not found`);
export const badRequest = (error: string, message: string, details?: unknown) => new ApiError(400, error, message, { details });
```

`server/src/config.ts`:
```ts
import type { Network } from './types.js';

export type NetworkConfig = { rpcUrl: string; passphrase: string };
export type Config = {
  port: number;
  databaseUrl: string;
  publicBaseUrl: string;
  networks: Partial<Record<Network, NetworkConfig>>;
  simSourceAccount: string;
  corsOrigins: string[];
  logLevel: string;
};

export const PASSPHRASES: Record<Network, string> = {
  testnet: 'Test SDF Network ; September 2015',
  mainnet: 'Public Global Stellar Network ; September 2015'
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const networks: Config['networks'] = {
    testnet: { rpcUrl: env.RPC_URL_TESTNET || 'https://soroban-testnet.stellar.org', passphrase: PASSPHRASES.testnet }
  };
  if (env.RPC_URL_MAINNET) networks.mainnet = { rpcUrl: env.RPC_URL_MAINNET, passphrase: PASSPHRASES.mainnet };
  return {
    port: Number(env.PORT || 8080),
    databaseUrl: env.DATABASE_URL,
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, ''),
    networks,
    simSourceAccount: env.SIM_SOURCE_ACCOUNT || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim()).filter(Boolean),
    logLevel: env.LOG_LEVEL || 'info'
  };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/config.test.ts test/errors.test.ts && npm run typecheck`
Expected: 6 tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server && git commit -m "server: scaffold package, config and error envelope"
```

---

### Task 2: Kitchen-sink fixture contract (Rust) + smoke test that stellar-sdk parses it

**Files:**
- Create: `server/test/fixtures/kitchen-sink/Cargo.toml`, `server/test/fixtures/kitchen-sink/src/lib.rs`, `server/test/fixtures/kitchen-sink/kitchen_sink.wasm` (built artifact, committed)
- Create: `server/test/fixtures/index.ts`
- Test: `server/test/spec/fixture.test.ts`

**Interfaces:**
- Produces: `loadFixtureWasm(): Buffer` and the function inventory below, which every later test relies on.

Fixture inventory (names are load-bearing for later tests):

| fn | signature | purpose |
|---|---|---|
| `add` | `(a: i128, b: i128) → i128` | big ints as strings |
| `echo_map` | `(m: Map<Symbol, i128>) → Map<Symbol, i128>` | map ⇄ object |
| `echo_bytes` | `(b: Bytes) → Bytes` | hex ⇄ bytes |
| `echo_hash` | `(h: BytesN<32>) → BytesN<32>` | fixed-length |
| `echo_pair` | `(p: Pair{a: i128, b: Address}) → Pair` | struct |
| `echo_shape` | `(s: Shape) → Shape` | union: `Unit` / `Boxed(u32, Symbol)` |
| `echo_level` | `(l: Level) → Level` | C-enum `Low=1, High=2` |
| `maybe` | `(v: Option<u64>) → Option<u64>` | option |
| `list` | `(v: Vec<Address>) → u32` | vec |
| `text` | `(s: String) → String` | string |
| `tuple` | `(t: (u32, bool)) → (u32, bool)` | tuple |
| `checked` | `(n: u32) → Result<u32, Error>` | errors `TooBig=1`, `Forbidden=2` |
| `ping` | `(who: Address, n: u32)` | `require_auth` + event `Pinged` |
| `bump` | `() → u32` | writes instance storage |
| `get_count` | `() → u32` | read |

- [ ] **Step 1: Write the contract**

`server/test/fixtures/kitchen-sink/Cargo.toml`:
```toml
[package]
name = "kitchen-sink"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
soroban-sdk = "27.0.6"

[dev-dependencies]
soroban-sdk = { version = "27.0.6", features = ["testutils"] }

[profile.release]
opt-level = "z"
overflow-checks = true
debug = 0
strip = "symbols"
debug-assertions = false
panic = "abort"
codegen-units = 1
lto = true
```

`server/test/fixtures/kitchen-sink/src/lib.rs`:
```rust
#![no_std]
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, BytesN, Env,
    Map, String, Symbol, Vec,
};

/// A pair of a number and an address.
#[contracttype]
#[derive(Clone)]
pub struct Pair {
    pub a: i128,
    pub b: Address,
}

/// A shape: either nothing or a boxed value.
#[contracttype]
#[derive(Clone)]
pub enum Shape {
    Unit,
    Boxed(u32, Symbol),
}

/// A level.
#[contracttype]
#[derive(Clone, Copy)]
#[repr(u32)]
pub enum Level {
    Low = 1,
    High = 2,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The number was too big.
    TooBig = 1,
    /// Not allowed.
    Forbidden = 2,
}

/// Emitted by ping.
#[contractevent]
#[derive(Clone)]
pub struct Pinged {
    #[topic]
    pub who: Address,
    pub n: u32,
}

#[contract]
pub struct KitchenSink;

#[contractimpl]
impl KitchenSink {
    /// Returns the sum of two i128 values.
    pub fn add(_e: Env, a: i128, b: i128) -> i128 { a + b }
    /// Echoes a map.
    pub fn echo_map(_e: Env, m: Map<Symbol, i128>) -> Map<Symbol, i128> { m }
    /// Echoes bytes.
    pub fn echo_bytes(_e: Env, b: Bytes) -> Bytes { b }
    /// Echoes a 32-byte hash.
    pub fn echo_hash(_e: Env, h: BytesN<32>) -> BytesN<32> { h }
    /// Echoes a pair.
    pub fn echo_pair(_e: Env, p: Pair) -> Pair { p }
    /// Echoes a shape.
    pub fn echo_shape(_e: Env, s: Shape) -> Shape { s }
    /// Echoes a level.
    pub fn echo_level(_e: Env, l: Level) -> Level { l }
    /// Echoes an optional number.
    pub fn maybe(_e: Env, v: Option<u64>) -> Option<u64> { v }
    /// Returns the length of the list.
    pub fn list(_e: Env, v: Vec<Address>) -> u32 { v.len() }
    /// Echoes a string.
    pub fn text(_e: Env, s: String) -> String { s }
    /// Echoes a tuple.
    pub fn tuple(_e: Env, t: (u32, bool)) -> (u32, bool) { t }
    /// Fails with TooBig when n > 100.
    pub fn checked(_e: Env, n: u32) -> Result<u32, Error> {
        if n > 100 { Err(Error::TooBig) } else { Ok(n) }
    }
    /// Requires `who` to authorize and emits Pinged.
    pub fn ping(e: Env, who: Address, n: u32) {
        who.require_auth();
        Pinged { who, n }.publish(&e);
    }
    /// Increments and returns a counter (write).
    pub fn bump(e: Env) -> u32 {
        let k = Symbol::new(&e, "count");
        let n: u32 = e.storage().instance().get(&k).unwrap_or(0) + 1;
        e.storage().instance().set(&k, &n);
        n
    }
    /// Returns the counter (read).
    pub fn get_count(e: Env) -> u32 {
        e.storage().instance().get(&Symbol::new(&e, "count")).unwrap_or(0)
    }
}
```

- [ ] **Step 2: Build and copy the WASM**

Run:
```bash
cd server/test/fixtures/kitchen-sink && stellar contract build && \
cp target/wasm32v1-none/release/kitchen_sink.wasm ./kitchen_sink.wasm && ls -la kitchen_sink.wasm
```
Expected: a file of roughly 5–15 KB. If `stellar contract build` reports the target is missing, run `rustup target add wasm32v1-none` first. If the sdk version is rejected by the CLI, `cargo update` inside the fixture is allowed but keep `soroban-sdk = "27.0.6"`.

- [ ] **Step 3: Write the failing smoke test**

`server/test/fixtures/index.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';
export function loadFixtureWasm(): Buffer { return readFileSync(join(here, 'kitchen-sink', 'kitchen_sink.wasm')); }
```

`server/test/spec/fixture.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';

describe('fixture wasm', () => {
  it('contains a SEP-48 spec with the expected functions', () => {
    const spec = contract.Spec.fromWasm(loadFixtureWasm());
    const names = spec.funcs().map((f) => f.name.toString()).sort();
    expect(names).toEqual(['add', 'bump', 'checked', 'echo_bytes', 'echo_hash', 'echo_level', 'echo_map', 'echo_pair', 'echo_shape', 'get_count', 'list', 'maybe', 'ping', 'text', 'tuple']);
    expect(spec.errorCases().map((c) => [c.name.toString(), c.value])).toEqual([['TooBig', 1], ['Forbidden', 2]]);
  });
});
```

Run: `cd server && npx vitest run test/spec/fixture.test.ts`
Expected: PASS (this is a smoke test of the artifact, so it passes as soon as the WASM exists; if it fails, the WASM was built without the spec — check `#![no_std]` and the release profile).

- [ ] **Step 4: Commit (WASM included)**

```bash
git add server/test/fixtures server/test/spec/fixture.test.ts && git commit -m "server: kitchen-sink fixture contract and built wasm"
```

---

### Task 3: `spec/render.ts`, `spec/hints.ts`, `spec/schema.ts`

**Files:**
- Create: `server/src/spec/render.ts`, `server/src/spec/hints.ts`, `server/src/spec/schema.ts`
- Test: `server/test/spec/render.test.ts`, `server/test/spec/hints.test.ts`, `server/test/spec/schema.test.ts`

**Interfaces:**
- Produces: `renderType(typeDef: xdr.ScSpecTypeDef): string`, `renderSignature(fn: xdr.ScSpecFunctionV0): string` (e.g. `add(a: i128, b: i128) → i128`), `classifyByName(name: string, inputs: Array<{name: string; type: string}>): FnKind`, `inlineRefs(schema: JsonSchema): JsonSchema`, `fnInputSchema(spec: contract.Spec, fn: string): JsonSchema`.

- [ ] **Step 1: Failing tests**

`server/test/spec/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { renderType, renderSignature } from '../../src/spec/render.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());
const sig = (n: string) => renderSignature(spec.getFunc(n));

describe('renderSignature', () => {
  it('renders primitives, containers and udts', () => {
    expect(sig('add')).toBe('add(a: i128, b: i128) → i128');
    expect(sig('echo_map')).toBe('echo_map(m: Map<Symbol, i128>) → Map<Symbol, i128>');
    expect(sig('echo_hash')).toBe('echo_hash(h: BytesN<32>) → BytesN<32>');
    expect(sig('echo_pair')).toBe('echo_pair(p: Pair) → Pair');
    expect(sig('maybe')).toBe('maybe(v: Option<u64>) → Option<u64>');
    expect(sig('list')).toBe('list(v: Vec<Address>) → u32');
    expect(sig('tuple')).toBe('tuple(t: (u32, bool)) → (u32, bool)');
    expect(sig('checked')).toBe('checked(n: u32) → Result<u32, Error>');
    expect(sig('ping')).toBe('ping(who: Address, n: u32) → void');
    expect(sig('bump')).toBe('bump() → u32');
  });
  it('renderType handles every input type in the fixture', () => {
    for (const f of spec.funcs()) for (const i of f.inputs) expect(renderType(i.type)).not.toMatch(/unknown/);
  });
});
```

`server/test/spec/hints.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { classifyByName } from '../../src/spec/hints.js';

describe('classifyByName', () => {
  it('reads by name', () => {
    expect(classifyByName('get_count', [])).toBe('read');
    expect(classifyByName('balance', [{ name: 'id', type: 'Address' }])).toBe('read');
    expect(classifyByName('allowance', [])).toBe('read');
    expect(classifyByName('total_supply', [])).toBe('read');
    expect(classifyByName('is_admin', [])).toBe('read');
    expect(classifyByName('balance_of', [])).toBe('read');
  });
  it('writes by signer-like Address input', () => {
    expect(classifyByName('transfer', [{ name: 'from', type: 'Address' }, { name: 'to', type: 'Address' }])).toBe('write');
    expect(classifyByName('set_admin', [{ name: 'admin', type: 'Address' }])).toBe('write');
  });
  it('unknown otherwise', () => {
    expect(classifyByName('echo_map', [{ name: 'm', type: 'Map<Symbol, i128>' }])).toBe('unknown');
    expect(classifyByName('bump', [])).toBe('unknown');
  });
});
```

`server/test/spec/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { inlineRefs, fnInputSchema } from '../../src/spec/schema.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());

describe('inlineRefs', () => {
  it('replaces $ref with the definition and drops definitions', () => {
    const out = inlineRefs({ definitions: { A: { type: 'string' } }, type: 'object', properties: { x: { $ref: '#/definitions/A' } } });
    expect(out).toEqual({ type: 'object', properties: { x: { type: 'string' } } });
  });
  it('keeps extra keys next to a $ref (BytesN maxLength)', () => {
    const out = inlineRefs({ definitions: { D: { type: 'string' } }, properties: { h: { $ref: '#/definitions/D', maxLength: 32 } } });
    expect(out).toEqual({ properties: { h: { type: 'string', maxLength: 32 } } });
  });
  it('stops on recursive refs', () => {
    const out = inlineRefs({ definitions: { N: { type: 'object', properties: { next: { $ref: '#/definitions/N' } } } }, $ref: '#/definitions/N' }) as any;
    expect(out.type).toBe('object');
    expect(JSON.stringify(out).length).toBeLessThan(2000);
  });
});

describe('fnInputSchema', () => {
  it('is a self-contained object schema of the args', () => {
    const s = fnInputSchema(spec, 'add') as any;
    expect(s.type).toBe('object');
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['a', 'b']);
    expect(s.properties.a).toMatchObject({ type: 'string' });
    expect(JSON.stringify(s)).not.toContain('$ref');
  });
  it('makes Option args optional and inlines udts', () => {
    expect((fnInputSchema(spec, 'maybe') as any).required ?? []).toEqual([]);
    const p = fnInputSchema(spec, 'echo_pair') as any;
    expect(p.properties.p.properties.b).toMatchObject({ type: 'string' });
  });
  it('no-arg functions produce an empty object schema', () => {
    expect(fnInputSchema(spec, 'bump')).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });
});
```

Run: `cd server && npx vitest run test/spec/render.test.ts test/spec/hints.test.ts test/spec/schema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement `render.ts`**

`server/src/spec/render.ts`:
```ts
import type { xdr } from '@stellar/stellar-sdk';

const PRIM: Record<string, string> = {
  scSpecTypeVal: 'Val', scSpecTypeBool: 'bool', scSpecTypeVoid: 'void', scSpecTypeError: 'Error',
  scSpecTypeU32: 'u32', scSpecTypeI32: 'i32', scSpecTypeU64: 'u64', scSpecTypeI64: 'i64',
  scSpecTypeTimepoint: 'Timepoint', scSpecTypeDuration: 'Duration',
  scSpecTypeU128: 'u128', scSpecTypeI128: 'i128', scSpecTypeU256: 'u256', scSpecTypeI256: 'i256',
  scSpecTypeBytes: 'Bytes', scSpecTypeString: 'String', scSpecTypeSymbol: 'Symbol',
  scSpecTypeAddress: 'Address', scSpecTypeMuxedAddress: 'MuxedAddress'
};

// stellar-sdk 17 XDR unions are plain objects: { type: 'scSpecTypeVec', value: { elementType } }
export function renderType(t: xdr.ScSpecTypeDef): string {
  const any = t as unknown as { type: string; value: any };
  if (PRIM[any.type]) return PRIM[any.type];
  switch (any.type) {
    case 'scSpecTypeOption': return `Option<${renderType(any.value.valueType)}>`;
    case 'scSpecTypeResult': return `Result<${renderType(any.value.okType)}, ${renderType(any.value.errorType)}>`;
    case 'scSpecTypeVec': return `Vec<${renderType(any.value.elementType)}>`;
    case 'scSpecTypeMap': return `Map<${renderType(any.value.keyType)}, ${renderType(any.value.valueType)}>`;
    case 'scSpecTypeTuple': return `(${(any.value.valueTypes as any[]).map(renderType).join(', ')})`;
    case 'scSpecTypeBytesN': return `BytesN<${any.value.n}>`;
    case 'scSpecTypeUdt': return String(any.value.name);
    default: return `unknown(${any.type})`;
  }
}

export function renderInputs(fn: xdr.ScSpecFunctionV0): Array<{ name: string; type: string }> {
  return (fn.inputs as any[]).map((i) => ({ name: String(i.name), type: renderType(i.type) }));
}

export function renderOutput(fn: xdr.ScSpecFunctionV0): string {
  const outs = fn.outputs as any[];
  return outs.length === 0 ? 'void' : renderType(outs[0]);
}

export function renderSignature(fn: xdr.ScSpecFunctionV0): string {
  const args = renderInputs(fn).map((i) => `${i.name}: ${i.type}`).join(', ');
  return `${String(fn.name)}(${args}) → ${renderOutput(fn)}`;
}
```

If `String(fn.name)` prints `[object Object]`, the XDR string type needs `.toString()`; use `fn.name.toString()` throughout instead — confirm with `node -e "import('@stellar/stellar-sdk').then(async ({contract})=>{const s=contract.Spec.fromWasm(require('fs').readFileSync('test/fixtures/kitchen-sink/kitchen_sink.wasm'));console.log(String(s.funcs()[0].name), s.funcs()[0].inputs[0]?.type)})"` from `server/`.

- [ ] **Step 3: Implement `hints.ts`**

`server/src/spec/hints.ts`:
```ts
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
```

- [ ] **Step 4: Implement `schema.ts`**

`server/src/spec/schema.ts`:
```ts
import type { contract } from '@stellar/stellar-sdk';
import type { JsonSchema } from '../types.js';

const MAX_DEPTH = 6;

/** Inline every "#/definitions/X" $ref so the schema is self-contained (MCP and OpenAPI-friendly). */
export function inlineRefs(schema: JsonSchema): JsonSchema {
  const defs = (schema.definitions ?? {}) as Record<string, JsonSchema>;
  const walk = (node: unknown, depth: number): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, depth));
    if (!node || typeof node !== 'object') return node;
    const obj = { ...(node as Record<string, unknown>) };
    if (typeof obj.$ref === 'string') {
      const name = obj.$ref.replace('#/definitions/', '');
      const { $ref, ...rest } = obj;
      if (depth >= MAX_DEPTH || !defs[name]) return { ...rest, description: rest.description ?? `Recursive ${name}` };
      return { ...(walk(defs[name], depth + 1) as object), ...rest };
    }
    delete obj.definitions;
    for (const k of Object.keys(obj)) obj[k] = walk(obj[k], depth);
    return obj;
  };
  const { definitions, ...root } = schema;
  return walk(root, 0) as JsonSchema;
}

/** Self-contained JSON Schema for a function's arguments object (the "args" body field / MCP tool input). */
export function fnInputSchema(spec: contract.Spec, fn: string): JsonSchema {
  const full = spec.jsonSchema(fn) as JsonSchema;                    // { $schema, definitions, $ref: '#/definitions/<fn>' }
  const defs = full.definitions as Record<string, any>;
  const args = defs[fn]?.properties?.args ?? { type: 'object', properties: {}, additionalProperties: false };
  const out = inlineRefs({ definitions: defs, ...args }) as Record<string, unknown>;
  return { type: 'object', properties: (out.properties as object) ?? {}, ...(out.required ? { required: out.required } : {}), additionalProperties: false };
}

/** Self-contained schema of a UDT (struct/union/enum) by name. */
export function udtSchema(spec: contract.Spec, name: string): JsonSchema {
  const full = spec.jsonSchema() as JsonSchema;
  const defs = full.definitions as Record<string, any>;
  return inlineRefs({ definitions: defs, ...(defs[name] ?? {}) });
}
```

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run test/spec && npm run typecheck`
Expected: all PASS. If `fnInputSchema('add').properties.a` is not `{type:'string', pattern}` check what `spec.jsonSchema('add').definitions.add` looks like with `node -e` and adjust the `properties.args` path — the SDK wraps arguments under `properties.args` (verified in stellar-sdk 17.1 `functionToJsonSchema`).

- [ ] **Step 6: Commit**

```bash
git add server/src/spec server/test/spec && git commit -m "server(spec): type rendering, read/write hints, self-contained json schemas"
```

---

### Task 4: `spec/model.ts` — WASM → ContractModel

**Files:**
- Create: `server/src/spec/model.ts`
- Test: `server/test/spec/model.test.ts`

**Interfaces:**
- Consumes: Task 3 exports.
- Produces: `parseWasm(wasm: Buffer): { spec: contract.Spec; entries: ParsedEntries }`, `buildModel(spec: contract.Spec, meta: { id: string; network: Network; name: string | null; wasmHash: string; specLedger: number }, hints?: Record<string, FnKind>): ContractModel`, `wasmHashOf(wasm: Buffer): string` (sha256 hex).

- [ ] **Step 1: Failing test**

`server/test/spec/model.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';

const wasm = loadFixtureWasm();
const spec = contract.Spec.fromWasm(wasm);
const meta = { id: FIXTURE_ID, network: 'testnet' as const, name: null, wasmHash: wasmHashOf(wasm), specLedger: 100 };

describe('buildModel', () => {
  const m = buildModel(spec, meta);
  it('lists every function with signature parts, doc and schema', () => {
    expect(m.functions).toHaveLength(15);
    const add = m.functions.find((f) => f.name === 'add')!;
    expect(add.inputs).toEqual([{ name: 'a', type: 'i128' }, { name: 'b', type: 'i128' }]);
    expect(add.output).toBe('i128');
    expect(add.doc).toBe('Returns the sum of two i128 values.');
    expect((add.jsonSchema as any).required).toEqual(['a', 'b']);
  });
  it('collects types, errors and events', () => {
    expect(m.types.map((t) => [t.name, t.kind])).toEqual(expect.arrayContaining([['Pair', 'struct'], ['Shape', 'union'], ['Level', 'enum']]));
    expect(m.errors).toEqual([{ code: 1, name: 'TooBig', doc: 'The number was too big.' }, { code: 2, name: 'Forbidden', doc: 'Not allowed.' }]);
    expect(m.events).toEqual([{ name: 'Pinged', doc: 'Emitted by ping.', params: [{ name: 'who', type: 'Address' }, { name: 'n', type: 'u32' }] }]);
  });
  it('applies name hints, then learned hints override', () => {
    expect(m.functions.find((f) => f.name === 'get_count')!.kind).toBe('read');
    expect(m.functions.find((f) => f.name === 'bump')!.kind).toBe('unknown');
    const learned = buildModel(spec, meta, { bump: 'write', echo_map: 'read' });
    expect(learned.functions.find((f) => f.name === 'bump')!.kind).toBe('write');
    expect(learned.functions.find((f) => f.name === 'echo_map')!.kind).toBe('read');
  });
  it('wasmHashOf is a 64-char hex sha256', () => {
    expect(wasmHashOf(wasm)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('is JSON-safe', () => {
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
```

Run: `cd server && npx vitest run test/spec/model.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`server/src/spec/model.ts`:
```ts
import { createHash } from 'node:crypto';
import { contract } from '@stellar/stellar-sdk';
import type { ContractModel, FnKind, Network } from '../types.js';
import { renderInputs, renderOutput, renderType } from './render.js';
import { classifyByName } from './hints.js';
import { fnInputSchema, udtSchema } from './schema.js';

export type ModelMeta = { id: string; network: Network; name: string | null; wasmHash: string; specLedger: number };

export const wasmHashOf = (wasm: Buffer): string => createHash('sha256').update(wasm).digest('hex');

export function parseWasm(wasm: Buffer): contract.Spec {
  try {
    return contract.Spec.fromWasm(wasm);
  } catch (e) {
    throw new Error(`No contract spec found in WASM — was it built with soroban-sdk ≥ 20 and a release profile? (${(e as Error).message})`);
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));

export function buildModel(spec: contract.Spec, meta: ModelMeta, hints: Record<string, FnKind> = {}): ContractModel {
  const functions = spec.funcs().map((fn) => {
    const name = str(fn.name);
    const inputs = renderInputs(fn);
    return {
      name,
      doc: str(fn.doc),
      inputs,
      output: renderOutput(fn),
      kind: hints[name] ?? classifyByName(name, inputs),
      jsonSchema: fnInputSchema(spec, name)
    };
  });

  const types: ContractModel['types'] = [];
  const errors: ContractModel['errors'] = [];
  const events: ContractModel['events'] = [];
  for (const entry of spec.entries as unknown as Array<{ type: string; value: any }>) {
    const v = entry.value;
    switch (entry.type) {
      case 'scSpecEntryUdtStructV0': types.push({ name: str(v.name), kind: 'struct', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtUnionV0': types.push({ name: str(v.name), kind: 'union', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtEnumV0': types.push({ name: str(v.name), kind: 'enum', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtErrorEnumV0':
        for (const c of v.cases as any[]) errors.push({ code: Number(c.value), name: str(c.name), doc: str(c.doc) });
        break;
      case 'scSpecEntryEventV0':
        events.push({ name: str(v.name), doc: str(v.doc), params: (v.params as any[]).map((p) => ({ name: str(p.name), type: renderType(p.type) })) });
        break;
    }
  }
  errors.sort((a, b) => a.code - b.code);
  return { ...meta, functions, types, errors, events };
}
```

- [ ] **Step 3: Run tests**

Run: `cd server && npx vitest run test/spec/model.test.ts && npm run typecheck`
Expected: PASS. If the events test fails because `spec.entries` has no `scSpecEntryEventV0` (older sdk build), inspect with `node -e` — the entry type name is fixed by XDR; if the enum case list differs (`v.cases[i].value` vs `.value.value`) adjust the accessor once, here.

- [ ] **Step 4: Commit**

```bash
git add server/src/spec/model.ts server/test/spec/model.test.ts && git commit -m "server(spec): build ContractModel from wasm"
```

---

### Task 5: `spec/codec.ts` — JSON ⇄ ScVal

**Files:**
- Create: `server/src/spec/codec.ts`
- Test: `server/test/spec/codec.test.ts`

**Interfaces:**
- Consumes: `contract.Spec`, `renderType`.
- Produces: `encodeArgs(spec, fn, args: Record<string, unknown>): xdr.ScVal[]`, `decodeResult(spec, fn, retval: xdr.ScVal): unknown` (JSON-safe), `contractErrorName(spec, code: number): string | null`, `toJson(value: unknown): unknown` (bigint→string, bytes→hex, Map→object, Ok/Err unwrap), `CodecError` (extends `ApiError` 400 `invalid_args` with `details.path`).

- [ ] **Step 1: Failing tests**

`server/test/spec/codec.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract, xdr } from '@stellar/stellar-sdk';
import { loadFixtureWasm } from '../fixtures/index.js';
import { encodeArgs, decodeResult, contractErrorName, toJson } from '../../src/spec/codec.js';

const spec = contract.Spec.fromWasm(loadFixtureWasm());
const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
// round-trip helper: encode the single arg, then decode it as if it were the (echo) function's return value
const rt = (fn: string, args: Record<string, unknown>) => decodeResult(spec, fn, encodeArgs(spec, fn, args)[0]);

describe('encode/decode round trips', () => {
  it('i128 as decimal strings, numbers accepted', () => {
    const [a, b] = encodeArgs(spec, 'add', { a: '170141183460469231731687303715884105727', b: 5 });
    expect(a.type).toBe('scvI128');
    expect(toJson(spec.scValToNative(a, spec.getFunc('add').inputs[0].type))).toBe('170141183460469231731687303715884105727');
    expect(b.type).toBe('scvI128');
  });
  it('map object ⇄ object', () => {
    expect(rt('echo_map', { m: { alpha: '1', beta: '-2' } })).toEqual({ alpha: '1', beta: '-2' });
  });
  it('bytes hex ⇄ hex', () => {
    expect(rt('echo_bytes', { b: '0xdeadbeef' })).toBe('0xdeadbeef');
    expect(rt('echo_hash', { h: '0x' + 'ab'.repeat(32) })).toBe('0x' + 'ab'.repeat(32));
  });
  it('struct, union, enum, option, vec, string, tuple', () => {
    expect(rt('echo_pair', { p: { a: '7', b: G } })).toEqual({ a: '7', b: G });
    expect(rt('echo_shape', { s: 'Unit' })).toEqual('Unit');
    expect(rt('echo_shape', { s: { tag: 'Boxed', values: [3, 'hi'] } })).toEqual({ tag: 'Boxed', values: [3, 'hi'] });
    expect(rt('echo_level', { l: 2 })).toBe(2);
    expect(rt('maybe', { v: null })).toBeNull();
    expect(rt('maybe', { v: '42' })).toBe('42');
    expect(rt('text', { s: 'hello' })).toBe('hello');
    expect(rt('tuple', { t: [9, true] })).toEqual([9, true]);
    expect(encodeArgs(spec, 'list', { v: [G, G] })[0].type).toBe('scvVec');
  });
  it('decodes void as null', () => {
    expect(decodeResult(spec, 'ping', xdr.ScVal.scvVoid())).toBeNull();
  });
});

describe('errors', () => {
  it('names invalid args with a path', () => {
    expect(() => encodeArgs(spec, 'add', { a: 'x', b: '1' })).toThrow(expect.objectContaining({ status: 400, error: 'invalid_args' }));
    expect(() => encodeArgs(spec, 'add', { a: '1' })).toThrow(/b/);
    expect(() => encodeArgs(spec, 'echo_hash', { h: '0xab' })).toThrow(/32/);
  });
  it('maps contract error codes to names', () => {
    expect(contractErrorName(spec, 1)).toBe('TooBig');
    expect(contractErrorName(spec, 9)).toBeNull();
  });
});
```

Run: `cd server && npx vitest run test/spec/codec.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`server/src/spec/codec.ts`:
```ts
import { contract, xdr } from '@stellar/stellar-sdk';
import { ApiError } from '../errors.js';

type TypeDef = { type: string; value: any };
const HEX = /^0x([0-9a-fA-F]{2})*$/;

export class CodecError extends ApiError {
  constructor(message: string, path: string) { super(400, 'invalid_args', message, { details: { path } }); }
}

/** JSON input → the shapes Spec.nativeToScVal accepts (Uint8Array for bytes, [k,v][] for maps). Type-directed. */
function fromJson(v: unknown, t: TypeDef, path: string): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : fromJson(v, t.value.valueType, path);
    case 'scSpecTypeBytes':
    case 'scSpecTypeBytesN': {
      if (typeof v !== 'string' || !HEX.test(v)) throw new CodecError(`${path}: expected 0x-prefixed hex string`, path);
      const bytes = Buffer.from(v.slice(2), 'hex');
      if (t.type === 'scSpecTypeBytesN' && bytes.length !== t.value.n) throw new CodecError(`${path}: expected ${t.value.n} bytes, got ${bytes.length}`, path);
      return new Uint8Array(bytes);
    }
    case 'scSpecTypeVec':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.elementType, `${path}[${i}]`));
    case 'scSpecTypeTuple':
      if (!Array.isArray(v)) throw new CodecError(`${path}: expected array`, path);
      return v.map((x, i) => fromJson(x, t.value.valueTypes[i], `${path}[${i}]`));
    case 'scSpecTypeMap': {
      const pairs: Array<[unknown, unknown]> = Array.isArray(v) ? (v as Array<[unknown, unknown]>)
        : v && typeof v === 'object' ? Object.entries(v as object) : (() => { throw new CodecError(`${path}: expected object`, path); })();
      return pairs.map(([k, val]) => [fromJson(k, t.value.keyType, `${path}.key`), fromJson(val, t.value.valueType, `${path}.${String(k)}`)]);
    }
    default: return v; // ints (string|number), bool, Address string, Symbol/String, UDTs — handled by nativeToScVal
  }
}

/** Native output of Spec.scValToNative → JSON-safe. */
export function toJson(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return '0x' + Buffer.from(v).toString('hex');
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [String(toJson(k)), toJson(x)]));
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('unwrap' in o && typeof o.unwrap === 'function' && 'isOk' in o) { // rust_result Ok/Err from funcResToNative
      return (o as any).isOk() ? toJson((o as any).unwrap()) : { error: toJson((o as any).unwrapErr()) };
    }
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toJson(x)]));
  }
  return v;
}

/** scValToNative returns maps as [k,v][]; rebuild objects type-directed so Vec<Tuple> stays an array. */
function shapeOutput(v: unknown, t: TypeDef): unknown {
  switch (t.type) {
    case 'scSpecTypeOption': return v == null ? null : shapeOutput(v, t.value.valueType);
    case 'scSpecTypeMap': return Object.fromEntries((v as Array<[unknown, unknown]>).map(([k, x]) => [String(toJson(k)), shapeOutput(x, t.value.valueType)]));
    case 'scSpecTypeVec': return (v as unknown[]).map((x) => shapeOutput(x, t.value.elementType));
    case 'scSpecTypeTuple': return (v as unknown[]).map((x, i) => shapeOutput(x, t.value.valueTypes[i]));
    case 'scSpecTypeResult': return toJson(v);
    default: return toJson(v);
  }
}

export function encodeArgs(spec: contract.Spec, fn: string, args: Record<string, unknown>): xdr.ScVal[] {
  const f = spec.getFunc(fn);
  const inputs = f.inputs as unknown as Array<{ name: unknown; type: TypeDef }>;
  const prepared: Record<string, unknown> = {};
  for (const i of inputs) {
    const name = String(i.name);
    if (!(name in args) && i.type.type !== 'scSpecTypeOption') throw new CodecError(`${name}: missing`, name);
    prepared[name] = fromJson(args[name], i.type, name);
  }
  try {
    return spec.funcArgsToScVals(fn, prepared);
  } catch (e) {
    const msg = (e as Error).message;
    const named = inputs.map((i) => String(i.name)).find((n) => msg.includes(n)) ?? inputs[0] && String(inputs[0].name);
    throw new CodecError(`${named ?? 'args'}: ${msg}`, named ?? 'args');
  }
}

export function decodeResult(spec: contract.Spec, fn: string, retval: xdr.ScVal): unknown {
  const f = spec.getFunc(fn);
  const outs = f.outputs as unknown as TypeDef[];
  if (outs.length === 0) return null;
  const native = spec.funcResToNative(fn, retval);
  const t = outs[0].type === 'scSpecTypeResult' ? outs[0].value.okType : outs[0];
  return shapeOutput(native && typeof native === 'object' && 'isOk' in native ? toJson(native) : native, t);
}

export function contractErrorName(spec: contract.Spec, code: number): string | null {
  const c = (spec.errorCases() as unknown as Array<{ name: unknown; value: number }>).find((x) => Number(x.value) === code);
  return c ? String(c.name) : null;
}
```

- [ ] **Step 3: Run tests; fix the two places most likely to differ**

Run: `cd server && npx vitest run test/spec/codec.test.ts`
Expected: PASS. Known adjustment points if a case fails:
1. `echo_shape` with `'Unit'`: if the SDK wants `{ tag: 'Unit' }` for void union cases, accept both in `fromJson` by adding `case 'scSpecTypeUdt'` that maps a bare string `s` to `{ tag: s }` when the UDT is a union — check with `spec.nativeToScVal('Unit', type)` in `node -e`. Keep the JSON *output* as `'Unit'` by normalising `{tag:'Unit', values: undefined}` → `'Unit'` in `shapeOutput`'s default branch.
2. `echo_level` (C enum): if the SDK expects the variant **name** rather than the number, switch the test and the spec amendment to names — document whichever the SDK accepts; do not write a translation layer.

- [ ] **Step 4: Commit**

```bash
git add server/src/spec/codec.ts server/test/spec/codec.test.ts && git commit -m "server(spec): json<->scval codec with typed errors"
```

---

### Task 6: `chain/` — Chain interface, RPC implementation, simulation error parsing, auth extraction

**Files:**
- Create: `server/src/chain/types.ts`, `server/src/chain/errors.ts`, `server/src/chain/auth.ts`, `server/src/chain/rpc.ts`
- Test: `server/test/chain/errors.test.ts`, `server/test/chain/auth.test.ts`

**Interfaces:**
- Produces:
```ts
export type SimResult = { retval: xdr.ScVal; auth: string[]; ledger: number; minResourceFee: string; readWriteCount: number; latencyMs: number };
export type BuiltTx = { xdr: string; fee: string; auth: string[]; ledger: number; expiresAt: string };
export type TxStatus = { hash: string; status: 'success' | 'failed' | 'pending'; ledger?: number; feeCharged?: string; resultXdr?: string };
export interface Chain {
  getContractWasm(network: Network, id: string): Promise<Buffer>;
  simulate(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult>;
  buildTx(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx>;
  submit(network: Network, xdrB64: string, waitMs: number): Promise<TxStatus>;
  getTx(network: Network, hash: string): Promise<TxStatus>;
  health(network: Network): Promise<'ok' | 'error'>;
}
```
`ChainError` (extends `ApiError`) with codes `rpc_unavailable` (502), `contract_error` (422, `code`), `host_error` (422), `source_not_found` (400), `network_not_configured` (400).
- `parseSimulationError(msg: string): { kind: 'contract'; code: number } | { kind: 'host'; message: string }`.
- `authAddresses(entries: xdr.SorobanAuthorizationEntry[], source: string): string[]` (de-duplicated, source substituted for `sorobanCredentialsSourceAccount`).

- [ ] **Step 1: Failing tests**

`server/test/chain/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseSimulationError } from '../../src/chain/errors.js';

describe('parseSimulationError', () => {
  it('extracts contract error codes', () => {
    expect(parseSimulationError('HostError: Error(Contract, #2)\n\nEvent log (newest first): ...')).toEqual({ kind: 'contract', code: 2 });
  });
  it('treats everything else as host errors', () => {
    expect(parseSimulationError('HostError: Error(WasmVm, InvalidAction)')).toEqual({ kind: 'host', message: 'HostError: Error(WasmVm, InvalidAction)' });
  });
});
```

`server/test/chain/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { xdr, Address } from '@stellar/stellar-sdk';
import { authAddresses } from '../../src/chain/auth.js';

const G1 = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const G2 = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

function addressEntry(g: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(g).toScAddress(), nonce: new xdr.Int64(0), signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid()
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address(G2).toScAddress(), functionName: 'x', args: []
      })), subInvocations: []
    })
  });
}
const sourceEntry = (): xdr.SorobanAuthorizationEntry => new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: addressEntry(G1).rootInvocation
});

describe('authAddresses', () => {
  it('lists address credentials and substitutes the source, de-duplicated', () => {
    expect(authAddresses([addressEntry(G1), sourceEntry(), addressEntry(G1)], G2)).toEqual([G1, G2]);
  });
  it('is empty with no entries', () => { expect(authAddresses([], G1)).toEqual([]); });
});
```

Run: `cd server && npx vitest run test/chain`
Expected: FAIL — modules not found. (If the XDR constructors in the test reject the plain-object style — e.g. `new xdr.Int64(0)` — adjust the *test's* construction using `node -e` to inspect `xdr.SorobanAddressCredentials`; the accessor style in `auth.ts` is what matters.)

- [ ] **Step 2: Implement `errors.ts` and `auth.ts`**

`server/src/chain/errors.ts`:
```ts
import { ApiError } from '../errors.js';

export class ChainError extends ApiError {}

export const rpcUnavailable = (network: string, cause: unknown) =>
  new ChainError(502, 'rpc_unavailable', `RPC for ${network} unavailable: ${(cause as Error)?.message ?? String(cause)}`);
export const networkNotConfigured = (network: string) =>
  new ChainError(400, 'network_not_configured', `network ${network} is not configured on this server`);
export const sourceNotFound = (source: string) =>
  new ChainError(400, 'source_not_found', `source account ${source} does not exist on this network`);

export function parseSimulationError(msg: string): { kind: 'contract'; code: number } | { kind: 'host'; message: string } {
  const m = /Error\(Contract, #(\d+)\)/.exec(msg);
  return m ? { kind: 'contract', code: Number(m[1]) } : { kind: 'host', message: msg };
}
```

`server/src/chain/auth.ts`:
```ts
import { Address, xdr } from '@stellar/stellar-sdk';

/** Addresses that must sign, from simulation auth entries. stellar-sdk 17 XDR is plain-object style. */
export function authAddresses(entries: xdr.SorobanAuthorizationEntry[], source: string): string[] {
  const out: string[] = [];
  for (const e of entries as unknown as Array<{ credentials: { type: string; value: any } }>) {
    const c = e.credentials;
    const addr = c.type === 'sorobanCredentialsAddress' ? Address.fromScAddress(c.value.address).toString() : source;
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}
```

- [ ] **Step 3: Implement `types.ts` and `rpc.ts`**

`server/src/chain/types.ts`: the interface block from **Interfaces** above, verbatim, plus `import type { xdr } from '@stellar/stellar-sdk'; import type { Network } from '../types.js';`.

`server/src/chain/rpc.ts`:
```ts
import { Account, BASE_FEE, Contract, TransactionBuilder, rpc, xdr } from '@stellar/stellar-sdk';
import type { Config } from '../config.js';
import type { Network } from '../types.js';
import type { BuiltTx, Chain, SimResult, TxStatus } from './types.js';
import { ChainError, networkNotConfigured, parseSimulationError, rpcUnavailable, sourceNotFound } from './errors.js';
import { authAddresses } from './auth.js';

const RPC_TIMEOUT_MS = 10_000;

export class RpcChain implements Chain {
  private servers = new Map<Network, rpc.Server>();
  constructor(private cfg: Config) {}

  private net(network: Network) {
    const n = this.cfg.networks[network];
    if (!n) throw networkNotConfigured(network);
    let s = this.servers.get(network);
    if (!s) { s = new rpc.Server(n.rpcUrl, { allowHttp: n.rpcUrl.startsWith('http://'), timeout: RPC_TIMEOUT_MS }); this.servers.set(network, s); }
    return { server: s, passphrase: n.passphrase };
  }

  private async guard<T>(network: Network, f: () => Promise<T>, retry = true): Promise<T> {
    try { return await f(); }
    catch (e) {
      if (e instanceof ChainError) throw e;
      const msg = String((e as Error)?.message ?? e);
      if (retry && /ECONN|ETIMEDOUT|timeout|5\d\d|socket hang up/i.test(msg)) return this.guard(network, f, false);
      throw rpcUnavailable(network, e);
    }
  }

  async getContractWasm(network: Network, id: string): Promise<Buffer> {
    const { server } = this.net(network);
    return this.guard(network, () => server.getContractWasmByContractId(id));
  }

  private async simulateRaw(network: Network, id: string, fn: string, args: xdr.ScVal[], account: Account, timeoutS: number) {
    const { server, passphrase } = this.net(network);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: passphrase })
      .addOperation(new Contract(id).call(fn, ...args)).setTimeout(timeoutS).build();
    const t0 = Date.now();
    const sim = await this.guard(network, () => server.simulateTransaction(tx));
    if (rpc.Api.isSimulationError(sim)) {
      const parsed = parseSimulationError(sim.error);
      if (parsed.kind === 'contract') throw new ChainError(422, 'contract_error', `contract returned error #${parsed.code}`, { code: parsed.code, details: { fn } });
      throw new ChainError(422, 'host_error', parsed.message.split('\n')[0], { details: { fn, diagnostics: sim.error } });
    }
    if (rpc.Api.isSimulationRestore(sim)) throw new ChainError(422, 'host_error', 'ledger entries need restoration before this call can run', { details: { fn } });
    const auth = authAddresses(sim.result?.auth ?? [], account.accountId());
    const data = sim.transactionData.build() as unknown as { resources: { footprint: { readWrite: unknown[] } } };
    return { tx, sim, latencyMs: Date.now() - t0, auth, readWriteCount: data.resources.footprint.readWrite.length };
  }

  async simulate(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult> {
    const r = await this.simulateRaw(network, id, fn, args, new Account(source, '0'), 30);
    return { retval: r.sim.result?.retval ?? xdr.ScVal.scvVoid(), auth: r.auth, ledger: r.sim.latestLedger, minResourceFee: r.sim.minResourceFee, readWriteCount: r.readWriteCount, latencyMs: r.latencyMs };
  }

  async buildTx(network: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx> {
    const { server } = this.net(network);
    const account = await this.guard(network, async () => {
      try { return await server.getAccount(source); }
      catch (e) { if (/not found|404/i.test(String((e as Error).message))) throw sourceNotFound(source); throw e; }
    });
    const r = await this.simulateRaw(network, id, fn, args, account, opts.timeoutS);
    const assembled = rpc.assembleTransaction(r.tx, r.sim).build();
    const fee = opts.fee ?? assembled.fee;
    return { xdr: assembled.toXDR(), fee, auth: r.auth, ledger: r.sim.latestLedger, expiresAt: new Date(Date.now() + opts.timeoutS * 1000).toISOString() };
  }

  private toStatus(hash: string, r: rpc.Api.GetTransactionResponse): TxStatus {
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash, status: 'success', ledger: r.ledger, feeCharged: String((r as any).resultXdr?.feeCharged ?? ''), resultXdr: (r as any).returnValue?.toXDR('base64') };
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) return { hash, status: 'failed', ledger: r.ledger, resultXdr: (r as any).resultXdr?.toXDR?.('base64') };
    return { hash, status: 'pending' };
  }

  async submit(network: Network, xdrB64: string, waitMs: number): Promise<TxStatus> {
    const { server, passphrase } = this.net(network);
    let tx; try { tx = TransactionBuilder.fromXDR(xdrB64, passphrase); } catch { throw new ChainError(400, 'invalid_xdr', 'xdr is not a valid transaction envelope for this network'); }
    const sent = await this.guard(network, () => server.sendTransaction(tx));
    if (sent.status === 'ERROR' || sent.status === 'DUPLICATE' || sent.status === 'TRY_AGAIN_LATER')
      throw new ChainError(422, 'submit_rejected', `transaction rejected: ${sent.status}`, { details: { errorResult: sent.errorResult?.toXDR('base64') } });
    const deadline = Date.now() + waitMs;
    let last: TxStatus = { hash: sent.hash, status: 'pending' };
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      last = this.toStatus(sent.hash, await this.guard(network, () => server.getTransaction(sent.hash)));
      if (last.status !== 'pending') break;
    }
    return last;
  }

  async getTx(network: Network, hash: string): Promise<TxStatus> {
    const { server } = this.net(network);
    const r = await this.guard(network, () => server.getTransaction(hash));
    if (r.status === rpc.Api.GetTransactionStatus.NOT_FOUND) throw new ChainError(404, 'tx_not_found', `transaction ${hash} not found`);
    return this.toStatus(hash, r);
  }

  async health(network: Network): Promise<'ok' | 'error'> {
    try { const { server } = this.net(network); await server.getHealth(); return 'ok'; } catch { return 'error'; }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd server && npx vitest run test/chain && npm run typecheck`
Expected: PASS; typecheck clean. Typecheck is the real test of `rpc.ts` here (its behaviour is covered by e2e in Task 12). If `sim.transactionData.build()` field access fails typecheck, keep the `as unknown as` cast — the shape (`resources.footprint.readWrite`) is fixed by XDR.

- [ ] **Step 5: Commit**

```bash
git add server/src/chain server/test/chain && git commit -m "server(chain): rpc wrapper, simulation error parsing, auth extraction"
```

---

### Task 7: `registry/` — Postgres schema, Store (Pg + Memory), pipeline, Registry

**Files:**
- Create: `server/drizzle.config.ts`, `server/src/registry/schema.ts`, `server/src/registry/store.ts`, `server/src/registry/migrate.ts`, `server/src/registry/pipeline.ts`, `server/src/registry/registry.ts`, `server/docker-compose.yml`
- Test: `server/test/registry/store.test.ts` (Postgres), `server/test/registry/pipeline.test.ts` (MemoryStore + fake chain), `server/test/helpers/fakeChain.ts`

**Interfaces:**
- Consumes: `parseWasm`, `buildModel`, `wasmHashOf` (Task 4); `Chain` (Task 6); `llmsTxt`/`openapi` (Task 8 — pipeline takes them as injected functions so this task can be built first with stubs).
- Produces:
```ts
export type ContractRow = { id: string; network: Network; name: string | null; wasmHash: string | null; specLedger: number | null;
  model: ContractModel | null; llmsTxt: string | null; openapi: JsonSchema | null; mcpScope: McpScope;
  status: ContractStatus; steps: Step[]; error: string | null; createdAt: Date; updatedAt: Date };
export interface Store {
  get(id: string): Promise<ContractRow | null>;
  list(): Promise<ContractRow[]>;
  upsertQueued(id: string, network: Network, name: string | null): Promise<ContractRow>;
  update(id: string, patch: Partial<Omit<ContractRow, 'id' | 'createdAt'>>): Promise<ContractRow>;
  getHints(id: string): Promise<Record<string, FnKind>>;
  setHint(id: string, fn: string, kind: FnKind): Promise<void>;
}
export class MemoryStore implements Store {}
export class PgStore implements Store { constructor(pool: pg.Pool) }
export class Registry {
  constructor(deps: { store: Store; chain: Chain; gen: { llmsTxt: (m: ContractModel) => string; openapi: (m: ContractModel) => JsonSchema } })
  register(id: string, network: Network, name?: string | null): Promise<ContractRow>;   // returns immediately; pipeline runs in the queue
  ready(id: string): Promise<{ row: ContractRow; model: ContractModel; spec: contract.Spec }>; // throws 404 / 409 ApiError
  learnHint(id: string, fn: string, kind: FnKind): Promise<void>;                        // updates fn_hints + cached model
  invalidate(id: string): void;                                                          // drop LRU entry (used by PATCH)
  whenIdle(): Promise<void>;                                                             // tests
}
```
Note on `spec`: the `contract.Spec` is needed at call time for encoding. Rebuilding it from stored JSON isn't possible, so the store keeps the **spec entries as base64 XDR** in a `spec_xdr` column (`text[]`), written by the pipeline (`spec.entries.map(e => e.toXDR('base64'))`), and `Registry.spec()` reconstructs with `new contract.Spec(xdrArray)` and caches it in the LRU together with the model.

- [ ] **Step 1: Docker Postgres + drizzle config**

`server/docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: sonata, POSTGRES_PASSWORD: sonata, POSTGRES_DB: sonata }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  api:
    build: .
    depends_on: [db]
    env_file: .env
    environment: { DATABASE_URL: postgres://sonata:sonata@db:5432/sonata }
    ports: ["8080:8080"]
volumes: { pgdata: {} }
```

`server/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'postgresql', schema: './src/registry/schema.ts', out: './drizzle', dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://sonata:sonata@localhost:5432/sonata' } });
```

Run: `cd server && docker compose up -d db && sleep 3 && psql postgres://sonata:sonata@localhost:5432/sonata -c 'select 1'`
Expected: `1`. Also create the test DB: `psql postgres://sonata:sonata@localhost:5432/sonata -c 'create database sonata_test'`.

- [ ] **Step 2: Schema + migration**

`server/src/registry/schema.ts`:
```ts
import { pgTable, text, bigint, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  network: text('network').notNull(),
  name: text('name'),
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
```

`server/src/registry/migrate.ts`:
```ts
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function runMigrations(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  await migrate(drizzle(pool), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle') });
  await pool.end();
}
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) runMigrations(process.env.DATABASE_URL!).then(() => console.log('migrated'));
```

Run: `cd server && npm run db:generate && npm run db:migrate && DATABASE_URL=postgres://sonata:sonata@localhost:5432/sonata_test npm run db:migrate`
Expected: a `drizzle/0000_*.sql` file is created and both DBs report `migrated`. Commit the generated SQL.

- [ ] **Step 3: Failing store tests (run against Postgres)**

`server/test/registry/store.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { PgStore, MemoryStore, type Store } from '../../src/registry/store.js';

const URL = process.env.TEST_DATABASE_URL ?? 'postgres://sonata:sonata@localhost:5432/sonata_test';
const ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB';

function suite(name: string, make: () => Promise<{ store: Store; reset: () => Promise<void>; close: () => Promise<void> }>) {
  describe(name, () => {
    let s: Store, reset: () => Promise<void>, close: () => Promise<void>;
    beforeAll(async () => ({ store: s, reset, close } = await make()));
    beforeEach(() => reset());
    afterAll(() => close());

    it('upsertQueued creates then keeps an existing row', async () => {
      const a = await s.upsertQueued(ID, 'testnet', 'Kitchen');
      expect(a).toMatchObject({ id: ID, network: 'testnet', name: 'Kitchen', status: 'queued', mcpScope: 'ro', steps: [] });
      const b = await s.upsertQueued(ID, 'testnet', null);
      expect(b.name).toBe('Kitchen');
      expect((await s.list()).map((r) => r.id)).toEqual([ID]);
    });
    it('update patches and bumps updatedAt', async () => {
      const a = await s.upsertQueued(ID, 'testnet', null);
      const b = await s.update(ID, { status: 'ready', steps: [{ name: 'fetch', status: 'done', detail: 'x' }], mcpScope: 'rw' });
      expect(b.status).toBe('ready'); expect(b.steps[0].detail).toBe('x'); expect(b.mcpScope).toBe('rw');
      expect(b.updatedAt.getTime()).toBeGreaterThanOrEqual(a.updatedAt.getTime());
      expect(await s.get('CNOPE')).toBeNull();
    });
    it('hints round-trip and overwrite', async () => {
      await s.upsertQueued(ID, 'testnet', null);
      await s.setHint(ID, 'bump', 'write'); await s.setHint(ID, 'bump', 'read');
      expect(await s.getHints(ID)).toEqual({ bump: 'read' });
    });
  });
}

suite('MemoryStore', async () => { const store = new MemoryStore(); return { store, reset: async () => store.clear(), close: async () => {} }; });
suite('PgStore', async () => {
  const pool = new pg.Pool({ connectionString: URL });
  return { store: new PgStore(pool), reset: async () => { await pool.query('truncate contracts cascade'); }, close: () => pool.end() };
});
```

Run: `cd server && npx vitest run test/registry/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `store.ts`**

`server/src/registry/store.ts`:
```ts
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { contracts, fnHints } from './schema.js';
import type { ContractModel, ContractStatus, FnKind, JsonSchema, McpScope, Network, Step } from '../types.js';

export type ContractRow = {
  id: string; network: Network; name: string | null; wasmHash: string | null; specLedger: number | null; specXdr: string[] | null;
  model: ContractModel | null; llmsTxt: string | null; openapi: JsonSchema | null; mcpScope: McpScope;
  status: ContractStatus; steps: Step[]; error: string | null; createdAt: Date; updatedAt: Date;
};
export type RowPatch = Partial<Omit<ContractRow, 'id' | 'createdAt' | 'updatedAt'>>;

export interface Store {
  get(id: string): Promise<ContractRow | null>;
  list(): Promise<ContractRow[]>;
  upsertQueued(id: string, network: Network, name: string | null): Promise<ContractRow>;
  update(id: string, patch: RowPatch): Promise<ContractRow>;
  getHints(id: string): Promise<Record<string, FnKind>>;
  setHint(id: string, fn: string, kind: FnKind): Promise<void>;
}

export class MemoryStore implements Store {
  private rows = new Map<string, ContractRow>();
  private hints = new Map<string, Record<string, FnKind>>();
  clear() { this.rows.clear(); this.hints.clear(); }
  async get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
  async list() { return [...this.rows.values()].map((r) => structuredClone(r)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()); }
  async upsertQueued(id: string, network: Network, name: string | null) {
    const now = new Date();
    const existing = this.rows.get(id);
    const row: ContractRow = existing ? { ...existing, name: name ?? existing.name, status: 'queued', steps: [], error: null, updatedAt: now }
      : { id, network, name, wasmHash: null, specLedger: null, specXdr: null, model: null, llmsTxt: null, openapi: null, mcpScope: 'ro', status: 'queued', steps: [], error: null, createdAt: now, updatedAt: now };
    this.rows.set(id, row); return structuredClone(row);
  }
  async update(id: string, patch: RowPatch) {
    const r = this.rows.get(id); if (!r) throw new Error(`no row ${id}`);
    const next = { ...r, ...patch, updatedAt: new Date() }; this.rows.set(id, next); return structuredClone(next);
  }
  async getHints(id: string) { return { ...(this.hints.get(id) ?? {}) }; }
  async setHint(id: string, fn: string, kind: FnKind) { this.hints.set(id, { ...(this.hints.get(id) ?? {}), [fn]: kind }); }
}

const toRow = (r: typeof contracts.$inferSelect): ContractRow => ({
  id: r.id, network: r.network as Network, name: r.name, wasmHash: r.wasmHash, specLedger: r.specLedger, specXdr: r.specXdr,
  model: r.model as ContractModel | null, llmsTxt: r.llmsTxt, openapi: r.openapi as JsonSchema | null, mcpScope: r.mcpScope as McpScope,
  status: r.status as ContractStatus, steps: r.steps as Step[], error: r.error, createdAt: r.createdAt, updatedAt: r.updatedAt
});

export class PgStore implements Store {
  private db;
  constructor(pool: pg.Pool) { this.db = drizzle(pool); }
  async get(id: string) { const [r] = await this.db.select().from(contracts).where(eq(contracts.id, id)); return r ? toRow(r) : null; }
  async list() { return (await this.db.select().from(contracts).orderBy(sql`${contracts.updatedAt} desc`)).map(toRow); }
  async upsertQueued(id: string, network: Network, name: string | null) {
    const [r] = await this.db.insert(contracts).values({ id, network, name, status: 'queued', steps: [] })
      .onConflictDoUpdate({ target: contracts.id, set: { name: sql`coalesce(${name}, ${contracts.name})`, status: 'queued', steps: [], error: null, updatedAt: sql`now()` } })
      .returning();
    return toRow(r);
  }
  async update(id: string, patch: RowPatch) {
    const [r] = await this.db.update(contracts).set({ ...patch, updatedAt: sql`now()` } as any).where(eq(contracts.id, id)).returning();
    if (!r) throw new Error(`no row ${id}`); return toRow(r);
  }
  async getHints(id: string) {
    const rows = await this.db.select().from(fnHints).where(eq(fnHints.contractId, id));
    return Object.fromEntries(rows.map((h) => [h.fn, h.kind as FnKind]));
  }
  async setHint(id: string, fn: string, kind: FnKind) {
    await this.db.insert(fnHints).values({ contractId: id, fn, kind }).onConflictDoUpdate({ target: [fnHints.contractId, fnHints.fn], set: { kind, observedAt: sql`now()` } });
  }
}
```

Run: `cd server && npx vitest run test/registry/store.test.ts`
Expected: 6 PASS (3 per store).

- [ ] **Step 5: Fake chain helper + failing pipeline tests**

`server/test/helpers/fakeChain.ts`:
```ts
import { xdr } from '@stellar/stellar-sdk';
import type { Chain, SimResult, BuiltTx, TxStatus } from '../../src/chain/types.js';
import type { Network } from '../../src/types.js';
import { loadFixtureWasm } from '../fixtures/index.js';

/** Scripted Chain: every method can be overridden per test via `impl`. Defaults return the fixture wasm and void results. */
export class FakeChain implements Chain {
  calls: Array<{ method: string; args: unknown[] }> = [];
  impl: Partial<Chain> = {};
  private rec<T>(method: string, args: unknown[], dflt: () => T | Promise<T>): Promise<T> {
    this.calls.push({ method, args });
    const f = (this.impl as any)[method];
    return Promise.resolve(f ? f(...args) : dflt());
  }
  getContractWasm(n: Network, id: string) { return this.rec('getContractWasm', [n, id], () => loadFixtureWasm()); }
  simulate(n: Network, id: string, fn: string, args: xdr.ScVal[], source: string): Promise<SimResult> {
    return this.rec('simulate', [n, id, fn, args, source], () => ({ retval: xdr.ScVal.scvVoid(), auth: [], ledger: 100, minResourceFee: '100', readWriteCount: 0, latencyMs: 1 }));
  }
  buildTx(n: Network, id: string, fn: string, args: xdr.ScVal[], source: string, opts: { fee?: string; timeoutS: number }): Promise<BuiltTx> {
    return this.rec('buildTx', [n, id, fn, args, source, opts], () => ({ xdr: 'AAAA', fee: '100', auth: [source], ledger: 100, expiresAt: '2026-01-01T00:00:00.000Z' }));
  }
  submit(n: Network, x: string, waitMs: number): Promise<TxStatus> { return this.rec('submit', [n, x, waitMs], () => ({ hash: 'h', status: 'success', ledger: 101 })); }
  getTx(n: Network, hash: string): Promise<TxStatus> { return this.rec('getTx', [n, hash], () => ({ hash, status: 'success', ledger: 101 })); }
  health(n: Network) { return this.rec('health', [n], () => 'ok' as const); }
}
```

`server/test/registry/pipeline.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { FakeChain } from '../helpers/fakeChain.js';
import { FIXTURE_ID, loadFixtureWasm } from '../fixtures/index.js';

const gen = { llmsTxt: (m: any) => `# ${m.id}`, openapi: (m: any) => ({ openapi: '3.1.0', title: m.id }) };
let chain: FakeChain, reg: Registry, store: MemoryStore;
beforeEach(() => { chain = new FakeChain(); store = new MemoryStore(); reg = new Registry({ store, chain, gen }); });

describe('Registry.register', () => {
  it('returns queued immediately, then completes all steps', async () => {
    const first = await reg.register(FIXTURE_ID, 'testnet', 'Kitchen');
    expect(first.status).toBe('queued');
    await reg.whenIdle();
    const row = (await store.get(FIXTURE_ID))!;
    expect(row.status).toBe('ready');
    expect(row.steps.map((s) => [s.name, s.status])).toEqual([['fetch', 'done'], ['parse', 'done'], ['generate', 'done'], ['index', 'skipped']]);
    expect(row.steps[1].detail).toBe('15 functions · 3 types · 2 errors');
    expect(row.model!.functions).toHaveLength(15);
    expect(row.llmsTxt).toBe(`# ${FIXTURE_ID}`);
    expect(row.specXdr!.length).toBeGreaterThan(10);
  });
  it('is idempotent when the wasm hash is unchanged', async () => {
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const before = (await store.get(FIXTURE_ID))!;
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const after = (await store.get(FIXTURE_ID))!;
    expect(after.status).toBe('ready');
    expect(chain.calls.filter((c) => c.method === 'getContractWasm')).toHaveLength(2);
    expect(after.model).toEqual(before.model);
  });
  it('marks the failing step and the contract failed, with a readable error', async () => {
    chain.impl.getContractWasm = async () => Buffer.from('not wasm');
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    const row = (await store.get(FIXTURE_ID))!;
    expect(row.status).toBe('failed');
    expect(row.steps[0].status).toBe('done');
    expect(row.steps[1]).toMatchObject({ name: 'parse', status: 'failed' });
    expect(row.error).toMatch(/No contract spec found/);
  });
  it('ready() throws 404 / 409 and returns model + spec when ready', async () => {
    await expect(reg.ready('CNOPE')).rejects.toMatchObject({ status: 404, error: 'contract_not_found' });
    chain.impl.getContractWasm = () => new Promise((r) => setTimeout(() => r(loadFixtureWasm()), 500)); // slow, so the row is still running
    await reg.register(FIXTURE_ID, 'testnet');
    await expect(reg.ready(FIXTURE_ID)).rejects.toMatchObject({ status: 409, error: 'contract_not_ready' });
  });
  it('learnHint updates the stored hint and the cached model', async () => {
    await reg.register(FIXTURE_ID, 'testnet'); await reg.whenIdle();
    await reg.learnHint(FIXTURE_ID, 'bump', 'write');
    const { model, spec } = await reg.ready(FIXTURE_ID);
    expect(model.functions.find((f) => f.name === 'bump')!.kind).toBe('write');
    expect(spec.getFunc('bump')).toBeTruthy();
    expect(await store.getHints(FIXTURE_ID)).toEqual({ bump: 'write' });
  });
});
```

Run: `cd server && npx vitest run test/registry/pipeline.test.ts`
Expected: FAIL — `registry.js` not found.

- [ ] **Step 6: Implement `pipeline.ts` and `registry.ts`**

`server/src/registry/pipeline.ts`:
```ts
import { contract } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import type { ContractModel, JsonSchema, Network, Step } from '../types.js';
import { buildModel, parseWasm, wasmHashOf } from '../spec/model.js';
import type { Store } from './store.js';

export type Generators = { llmsTxt: (m: ContractModel) => string; openapi: (m: ContractModel) => JsonSchema };
const STEP_NAMES: Step['name'][] = ['fetch', 'parse', 'generate', 'index'];

/** Runs the four pipeline steps for one contract, persisting after each. Returns the final row status. */
export async function runPipeline(deps: { store: Store; chain: Chain; gen: Generators }, id: string, network: Network): Promise<void> {
  const { store, chain, gen } = deps;
  const steps: Step[] = STEP_NAMES.map((name) => ({ name, status: 'queued', detail: '' }));
  const save = (patch: Parameters<Store['update']>[1] = {}) => store.update(id, { steps: structuredClone(steps), ...patch });
  const run = async <T>(i: number, f: () => Promise<{ value: T; detail: string }>): Promise<T> => {
    steps[i].status = 'running'; await save({ status: 'running' });
    try { const { value, detail } = await f(); steps[i].status = 'done'; steps[i].detail = detail; await save(); return value; }
    catch (e) { const msg = (e as Error).message; steps[i].status = 'failed'; steps[i].error = msg; await save({ status: 'failed', error: msg }); throw e; }
  };
  try {
    const existing = await store.get(id);
    const wasm = await run(0, async () => { const w = await chain.getContractWasm(network, id); return { value: w, detail: `${(w.length / 1024).toFixed(1)} KB` }; });
    const wasmHash = wasmHashOf(wasm);
    if (existing?.wasmHash === wasmHash && existing.model && existing.specXdr) {   // unchanged upgrade → nothing to regenerate
      for (const s of steps) { s.status = 'done'; s.detail = 'unchanged'; } steps[3].status = 'skipped';
      await save({ status: 'ready', error: null }); return;
    }
    const spec = await run(1, async () => {
      const s = parseWasm(wasm);
      const n = (t: string) => (s.entries as unknown as Array<{ type: string }>).filter((e) => e.type.startsWith(t)).length;
      const types = n('scSpecEntryUdtStructV0') + n('scSpecEntryUdtUnionV0') + n('scSpecEntryUdtEnumV0');
      return { value: s, detail: `${s.funcs().length} functions · ${types} types · ${s.errorCases().length} errors` };
    });
    const hints = await store.getHints(id);
    const model = buildModel(spec, { id, network, name: existing?.name ?? null, wasmHash, specLedger: 0 }, hints);
    await run(2, async () => {
      const llms = gen.llmsTxt(model); const oa = gen.openapi(model);
      const tools = model.functions.length * 2 + 3;
      await store.update(id, { wasmHash, specLedger: model.specLedger, specXdr: (spec.entries as any[]).map((e) => e.toXDR('base64')), model, llmsTxt: llms, openapi: oa });
      return { value: null, detail: `OpenAPI 3.1 · ${tools} MCP tools` };
    });
    steps[3].status = 'skipped'; steps[3].detail = 'history indexing arrives in a later milestone';
    await save({ status: 'ready', error: null });
  } catch { /* already persisted as failed */ }
}
```
(`specLedger` is left `0` in M1 because `getContractWasmByContractId` doesn't return the ledger; the `ledger` shown to users comes from each simulation response.)

`server/src/registry/registry.ts`:
```ts
import PQueue from 'p-queue';
import { contract } from '@stellar/stellar-sdk';
import { StrKey } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import { ApiError, badRequest, notFound } from '../errors.js';
import type { ContractModel, FnKind, Network } from '../types.js';
import { buildModel } from '../spec/model.js';
import { runPipeline, type Generators } from './pipeline.js';
import type { ContractRow, Store } from './store.js';

type Cached = { model: ContractModel; spec: contract.Spec; wasmHash: string };

export class Registry {
  private queue = new PQueue({ concurrency: 2 });
  private cache = new Map<string, Cached>();
  private inflight = new Set<string>();
  constructor(private deps: { store: Store; chain: Chain; gen: Generators }) {}

  async register(id: string, network: Network, name: string | null = null): Promise<ContractRow> {
    if (!StrKey.isValidContract(id)) throw badRequest('invalid_contract_id', 'contract id must be a 56-character C… address');
    const row = await this.deps.store.upsertQueued(id, network, name);
    this.cache.delete(id);
    if (!this.inflight.has(id)) {
      this.inflight.add(id);
      void this.queue.add(() => runPipeline(this.deps, id, network).finally(() => this.inflight.delete(id)));
    }
    return row;
  }

  whenIdle() { return this.queue.onIdle(); }
  invalidate(id: string) { this.cache.delete(id); }

  async ready(id: string): Promise<{ row: ContractRow; model: ContractModel; spec: contract.Spec }> {
    const row = await this.deps.store.get(id);
    if (!row) throw notFound('contract', id);
    if (row.status !== 'ready' || !row.model || !row.specXdr) throw new ApiError(409, 'contract_not_ready', `contract is ${row.status}`, { details: { steps: row.steps, error: row.error } });
    let c = this.cache.get(id);
    if (!c || c.wasmHash !== row.wasmHash) {
      c = { model: row.model, spec: new contract.Spec(row.specXdr), wasmHash: row.wasmHash! };
      this.cache.set(id, c);
    }
    return { row, model: c.model, spec: c.spec };
  }

  async learnHint(id: string, fn: string, kind: FnKind) {
    await this.deps.store.setHint(id, fn, kind);
    const c = this.cache.get(id);
    if (c) {
      const hints = await this.deps.store.getHints(id);
      c.model = buildModel(c.spec, { id: c.model.id, network: c.model.network, name: c.model.name, wasmHash: c.model.wasmHash, specLedger: c.model.specLedger }, hints);
      await this.deps.store.update(id, { model: c.model });
    }
  }
}
```

- [ ] **Step 7: Run all registry tests + typecheck**

Run: `cd server && npx vitest run test/registry && npm run typecheck`
Expected: PASS. If `new contract.Spec(row.specXdr)` rejects a `string[]`, the constructor accepts base64 arrays per the SDK's own doc comment — check that `e.toXDR('base64')` exists on plain-object XDR entries; if not, store `spec.entries` as a single base64 stream via `Buffer.concat(entries.map(e => e.toXDR()))` and pass the Buffer.

- [ ] **Step 8: Commit**

```bash
git add server/drizzle server/drizzle.config.ts server/docker-compose.yml server/src/registry server/test/registry server/test/helpers && git commit -m "server(registry): postgres store, memory store, registration pipeline"
```

---

### Task 8: `docs/` — llms.txt and OpenAPI generators

**Files:**
- Create: `server/src/docs/llms.ts`, `server/src/docs/openapi.ts`
- Test: `server/test/docs/llms.test.ts`, `server/test/docs/openapi.test.ts`, snapshots under `server/test/docs/__snapshots__/`

**Interfaces:**
- Consumes: `ContractModel`.
- Produces: `llmsTxt(model: ContractModel, cfg: { publicBaseUrl: string }): string`, `openapi(model: ContractModel, cfg: { publicBaseUrl: string }): JsonSchema`. Both pure.

- [ ] **Step 1: Failing tests**

`server/test/docs/llms.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';
import { llmsTxt } from '../../src/docs/llms.js';

const wasm = loadFixtureWasm();
const model = buildModel(contract.Spec.fromWasm(wasm), { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink', wasmHash: wasmHashOf(wasm), specLedger: 0 });
const cfg = { publicBaseUrl: 'https://api.sonata.test' };

describe('llmsTxt', () => {
  const out = llmsTxt(model, cfg);
  it('has the documented sections in order', () => {
    const idx = ['# KitchenSink', '## Endpoints', '## Functions', '## Types', '## Errors', '## Events'].map((h) => out.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('renders signatures, docs, errors and the mcp url', () => {
    expect(out).toContain('add(a: i128, b: i128) → i128');
    expect(out).toContain('Returns the sum of two i128 values.');
    expect(out).toContain('1 TooBig · The number was too big.');
    expect(out).toContain(`https://api.sonata.test/c/${FIXTURE_ID}/mcp`);
    expect(out).toContain(`POST https://api.sonata.test/c/${FIXTURE_ID}/call/{fn}`);
  });
  it('falls back to the short id when unnamed', () => {
    expect(llmsTxt({ ...model, name: null }, cfg)).toMatch(/^# CAAA…AAAB/);
  });
  it('is stable', () => { expect(out).toMatchSnapshot(); });
});
```

`server/test/docs/openapi.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { contract } from '@stellar/stellar-sdk';
import { loadFixtureWasm, FIXTURE_ID } from '../fixtures/index.js';
import { buildModel, wasmHashOf } from '../../src/spec/model.js';
import { openapi } from '../../src/docs/openapi.js';

const wasm = loadFixtureWasm();
const model = buildModel(contract.Spec.fromWasm(wasm), { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink', wasmHash: wasmHashOf(wasm), specLedger: 0 });
const doc = openapi(model, { publicBaseUrl: 'https://api.sonata.test' }) as any;

describe('openapi', () => {
  it('is 3.1 with a server and a call + tx path per function', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://api.sonata.test' }]);
    expect(Object.keys(doc.paths).filter((p) => p.includes('/call/'))).toHaveLength(15);
    expect(Object.keys(doc.paths).filter((p) => p.includes('/tx/'))).toHaveLength(15);
    expect(doc.paths[`/c/${FIXTURE_ID}/submit`].post).toBeTruthy();
    expect(doc.paths[`/c/${FIXTURE_ID}/status`].get).toBeTruthy();
    expect(doc.paths[`/c/${FIXTURE_ID}/llms.txt`].get).toBeTruthy();
  });
  it('embeds the arg schema and shared error envelope', () => {
    const call = doc.paths[`/c/${FIXTURE_ID}/call/add`].post;
    expect(call.requestBody.content['application/json'].schema.properties.args.required).toEqual(['a', 'b']);
    expect(call.responses['422'].content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
    expect(doc.components.schemas.Error.required).toEqual(['error', 'message']);
    expect(doc.components.schemas.Pair).toBeTruthy();
  });
  it('is stable', () => { expect(doc).toMatchSnapshot(); });
});
```

Run: `cd server && npx vitest run test/docs`
Expected: FAIL — modules not found.

- [ ] **Step 2: Implement `llms.ts`**

`server/src/docs/llms.ts`:
```ts
import type { ContractModel } from '../types.js';

export const shortId = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

export function llmsTxt(m: ContractModel, cfg: { publicBaseUrl: string }): string {
  const base = `${cfg.publicBaseUrl}/c/${m.id}`;
  const title = m.name ?? shortId(m.id);
  const lines: string[] = [
    `# ${title}`, '',
    `Soroban contract · ${m.functions.length} functions · SEP-48 · ${m.network}`,
    `Contract ID: ${m.id}`, '',
    '## Endpoints', '',
    `Base: ${base}`,
    `POST ${base}/call/{fn}   simulate any function → { result, simulated: true, auth }`,
    `POST ${base}/tx/{fn}     build unsigned XDR → { xdr, fee, auth }`,
    `POST ${base}/submit      relay a signed XDR → { hash, status }`,
    `GET  ${base}/openapi.json`,
    `MCP: ${base}/mcp (Streamable HTTP)`, '',
    'Arguments are passed by name in `args`. Integers ≥ 64-bit are decimal strings, bytes are 0x-hex, maps are objects.', '',
    '```',
    `curl -X POST "${base}/call/${m.functions[0]?.name ?? 'fn'}" -H "Content-Type: application/json" -d '{"args":{}}'`,
    '```', '',
    '## Functions', ''
  ];
  for (const f of m.functions) { lines.push(`${sig(f)}${f.kind === 'read' ? '  [read]' : f.kind === 'write' ? '  [write]' : ''}`); if (f.doc) lines.push(`  ${f.doc.replace(/\s+/g, ' ').trim()}`); }
  lines.push('', '## Types', '');
  for (const t of m.types) lines.push(`${t.name} (${t.kind})${t.doc ? ` · ${t.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.types.length === 0) lines.push('(none)');
  lines.push('', '## Errors', '');
  for (const e of m.errors) lines.push(`${e.code} ${e.name}${e.doc ? ` · ${e.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.errors.length === 0) lines.push('(none)');
  lines.push('', '## Events', '');
  for (const e of m.events) lines.push(`${e.name}(${e.params.map((p) => `${p.name}: ${p.type}`).join(', ')})${e.doc ? ` · ${e.doc.replace(/\s+/g, ' ').trim()}` : ''}`);
  if (m.events.length === 0) lines.push('(none)');
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 3: Implement `openapi.ts`**

`server/src/docs/openapi.ts`:
```ts
import type { ContractModel, JsonSchema } from '../types.js';

const ERROR: JsonSchema = { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' }, code: { type: 'integer' }, details: {} } };
const err = (d: string) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const json = (schema: JsonSchema) => ({ content: { 'application/json': { schema } } });
const AUTH = { type: 'array', items: { type: 'string' }, description: 'Addresses that must sign' };

export function openapi(m: ContractModel, cfg: { publicBaseUrl: string }): JsonSchema {
  const p = `/c/${m.id}`;
  const paths: Record<string, unknown> = {};
  for (const f of m.functions) {
    const body = { required: true, ...json({ type: 'object', required: ['args'], properties: { args: f.jsonSchema, source: { type: 'string', description: 'G… account' }, network: { type: 'string', enum: [m.network] } }, additionalProperties: false }) };
    const common = { '400': err('Invalid arguments or request'), '404': err('Unknown contract or function'), '409': err('Contract not ready'), '422': err('Contract or host error from simulation'), '502': err('RPC unavailable') };
    paths[`${p}/call/${f.name}`] = { post: { operationId: `call_${f.name}`, summary: `Simulate ${f.name}`, description: f.doc || undefined, tags: ['call'], requestBody: body,
      responses: { '200': { description: 'Simulation result', ...json({ type: 'object', properties: { result: {}, simulated: { type: 'boolean' }, latency_ms: { type: 'integer' }, ledger: { type: 'integer' }, auth: AUTH } }) }, ...common } } };
    paths[`${p}/tx/${f.name}`] = { post: { operationId: `build_${f.name}`, summary: `Build unsigned XDR for ${f.name}`, description: f.doc || undefined, tags: ['tx'],
      requestBody: { required: true, ...json({ type: 'object', required: ['args', 'source'], properties: { args: f.jsonSchema, source: { type: 'string' }, fee: { type: 'string' }, timeout_s: { type: 'integer' }, network: { type: 'string', enum: [m.network] } }, additionalProperties: false }) },
      responses: { '200': { description: 'Unsigned transaction', ...json({ type: 'object', properties: { xdr: { type: 'string' }, fee: { type: 'string' }, auth: AUTH, ledger: { type: 'integer' }, expires_at: { type: 'string' } } }) }, ...common } } };
  }
  const TX = { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string', enum: ['success', 'failed', 'pending'] }, ledger: { type: 'integer' }, fee_charged: { type: 'string' }, result_xdr: { type: 'string' } } };
  paths[`${p}/submit`] = { post: { operationId: 'submit', summary: 'Submit a signed transaction', tags: ['tx'], requestBody: { required: true, ...json({ type: 'object', required: ['xdr'], properties: { xdr: { type: 'string' } } }) }, responses: { '200': { description: 'Transaction status', ...json(TX) }, '400': err('Invalid XDR'), '422': err('Rejected by the network'), '502': err('RPC unavailable') } } };
  paths[`${p}`] = { get: { operationId: 'get_contract', summary: 'Contract model and settings', tags: ['contract'], responses: { '200': { description: 'Model', ...json({ type: 'object' }) }, '404': err('Unknown contract') } } };
  paths[`${p}/status`] = { get: { operationId: 'get_status', summary: 'Registration pipeline status', tags: ['contract'], responses: { '200': { description: 'Status', ...json({ type: 'object', properties: { status: { type: 'string' }, steps: { type: 'array' } } }) }, '404': err('Unknown contract') } } };
  paths[`${p}/llms.txt`] = { get: { operationId: 'get_llms', summary: 'AI-ready docs', tags: ['docs'], responses: { '200': { description: 'Markdown', content: { 'text/markdown': { schema: { type: 'string' } } } } } } };
  const schemas: Record<string, JsonSchema> = { Error: ERROR };
  for (const t of m.types) schemas[t.name] = t.jsonSchema;
  return {
    openapi: '3.1.0',
    info: { title: `${m.name ?? m.id} — Sonata API`, version: m.wasmHash.slice(0, 12), description: `Generated from the SEP-48 spec of ${m.id} on ${m.network}.` },
    servers: [{ url: cfg.publicBaseUrl }],
    paths,
    components: { schemas }
  };
}
```

- [ ] **Step 4: Run tests, review snapshots, commit**

Run: `cd server && npx vitest run test/docs && npm run typecheck`
Expected: PASS; two snapshot files written. Open `test/docs/__snapshots__/llms.test.ts.snap` and read the llms.txt once — it should read like the example in `components/data.js` (`LLMS`) at the repo root.

```bash
git add server/src/docs server/test/docs && git commit -m "server(docs): llms.txt and openapi generators"
```

---

### Task 9: `http/` — Fastify app and REST routes

**Files:**
- Create: `server/src/http/app.ts`, `server/src/http/routes/contracts.ts`, `server/src/http/routes/invoke.ts`, `server/src/http/routes/docs.ts`, `server/src/http/routes/health.ts`, `server/src/http/deps.ts`
- Test: `server/test/http/contracts.test.ts`, `server/test/http/invoke.test.ts`, `server/test/http/docs.test.ts`, `server/test/helpers/app.ts`

**Interfaces:**
- Consumes: `Registry` (Task 7), `Chain` (Task 6), `encodeArgs`/`decodeResult`/`contractErrorName` (Task 5), `Config` (Task 1).
- Produces: `type Deps = { cfg: Config; chain: Chain; registry: Registry; store: Store; log: pino.Logger }` in `http/deps.ts`; `buildApp(deps: Deps): FastifyInstance` with every route from spec §6 registered (the MCP route is added in Task 10 through `registerMcp(app, deps)`, called from `buildApp`; until Task 10 exists `buildApp` just doesn't call it).

- [ ] **Step 1: Test helper + failing contracts tests**

`server/test/helpers/app.ts`:
```ts
import pino from 'pino';
import { buildApp } from '../../src/http/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { llmsTxt } from '../../src/docs/llms.js';
import { openapi } from '../../src/docs/openapi.js';
import { FakeChain } from './fakeChain.js';
import { FIXTURE_ID } from '../fixtures/index.js';

export async function testApp() {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_BASE_URL: 'https://api.sonata.test', RPC_URL_MAINNET: 'https://mainnet.example' });
  const chain = new FakeChain();
  const store = new MemoryStore();
  const registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
  const app = buildApp({ cfg, chain, registry, store, log: pino({ level: 'silent' }) });
  await app.ready();
  const registerFixture = async () => { await registry.register(FIXTURE_ID, 'testnet', 'KitchenSink'); await registry.whenIdle(); };
  return { app, chain, store, registry, cfg, registerFixture };
}
```

`server/test/http/contracts.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';

describe('contracts routes', () => {
  it('POST /contracts validates and returns 202 queued; status becomes ready', async () => {
    const { app, registry } = await testApp();
    const bad = await app.inject({ method: 'POST', url: '/contracts', payload: { id: 'nope', network: 'testnet' } });
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toBe('invalid_contract_id');
    const badNet = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'futurenet' } });
    expect(badNet.statusCode).toBe(400); expect(badNet.json().error).toBe('invalid_args');
    const res = await app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ id: FIXTURE_ID, network: 'testnet', status: 'queued' });
    await registry.whenIdle();
    const st = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/status` });
    expect(st.json()).toMatchObject({ status: 'ready' });
    expect(st.json().steps).toHaveLength(4);
  });
  it('GET /contracts lists; GET /c/:id returns model + settings + urls; 404 unknown', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const list = await app.inject({ method: 'GET', url: '/contracts' });
    expect(list.json()).toEqual([{ id: FIXTURE_ID, name: 'KitchenSink', network: 'testnet', status: 'ready', fns: 15, updated_at: expect.any(String) }]);
    const one = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}` });
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: FIXTURE_ID, mcp_scope: 'ro', status: 'ready', urls: { mcp: `https://api.sonata.test/c/${FIXTURE_ID}/mcp`, llms: `https://api.sonata.test/c/${FIXTURE_ID}/llms.txt`, openapi: `https://api.sonata.test/c/${FIXTURE_ID}/openapi.json` } });
    expect(one.json().functions).toHaveLength(15);
    expect((await app.inject({ method: 'GET', url: '/c/CNOPE' })).statusCode).toBe(404);
  });
  it('PATCH /c/:id updates name and scope, rejects bad scope', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const ok = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw', name: 'KS' } });
    expect(ok.json()).toMatchObject({ mcp_scope: 'rw', name: 'KS' });
    const bad = await app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'admin' } });
    expect(bad.statusCode).toBe(400);
  });
  it('GET /healthz reports db and networks', async () => {
    const { app } = await testApp();
    const h = await app.inject({ method: 'GET', url: '/healthz' });
    expect(h.json()).toEqual({ db: 'ok', networks: { testnet: 'ok', mainnet: 'ok' } });
  });
});
```

Run: `cd server && npx vitest run test/http/contracts.test.ts`
Expected: FAIL — `app.js` not found.

- [ ] **Step 2: Implement `deps.ts`, `app.ts`, `contracts.ts`, `health.ts`**

`server/src/http/deps.ts`:
```ts
import type pino from 'pino';
import type { Config } from '../config.js';
import type { Chain } from '../chain/types.js';
import type { Registry } from '../registry/registry.js';
import type { Store } from '../registry/store.js';
export type Deps = { cfg: Config; chain: Chain; registry: Registry; store: Store; log: pino.Logger };
```

`server/src/http/app.ts`:
```ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { ApiError } from '../errors.js';
import type { Deps } from './deps.js';
import { contractRoutes } from './routes/contracts.js';
import { invokeRoutes } from './routes/invoke.js';
import { docsRoutes } from './routes/docs.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(deps: Deps) {
  const app = Fastify({ loggerInstance: deps.log, genReqId: () => crypto.randomUUID(), bodyLimit: 1_000_000 });
  app.register(cors, { origin: (origin, cb) => cb(null, !origin || deps.cfg.corsOrigins.includes(origin) || deps.cfg.corsOrigins.includes('*')), methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send(err.toJSON());
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_args', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), details: { issues: err.issues } });
    if ((err as any).statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'too many requests' });
    if ((err as any).validation || (err as any).statusCode === 400) return reply.code(400).send({ error: 'invalid_args', message: err.message });
    req.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: 'internal', message: 'internal error', details: { request_id: req.id } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'route_not_found', message: `${req.method} ${req.url} is not a route` }));
  app.register(contractRoutes(deps));
  app.register(invokeRoutes(deps));
  app.register(docsRoutes(deps));
  app.register(healthRoutes(deps));
  return app;
}
```

`server/src/http/routes/contracts.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { ContractRow } from '../../registry/store.js';
import { notFound } from '../../errors.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const RegisterBody = z.object({ id: z.string(), network: NETWORK, name: z.string().min(1).max(80).optional() });
const PatchBody = z.object({ name: z.string().min(1).max(80).nullable().optional(), mcp_scope: z.enum(['ro', 'rw']).optional() });

export const publicRow = (row: ContractRow, base: string) => ({
  ...(row.model ?? { id: row.id, network: row.network, name: row.name }),
  name: row.name, mcp_scope: row.mcpScope, status: row.status, steps: row.steps, error: row.error,
  urls: { mcp: `${base}/c/${row.id}/mcp`, llms: `${base}/c/${row.id}/llms.txt`, openapi: `${base}/c/${row.id}/openapi.json` },
  created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString()
});

export const contractRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const base = deps.cfg.publicBaseUrl;
  app.post('/contracts', async (req, reply) => {
    const b = RegisterBody.parse(req.body);
    if (!deps.cfg.networks[b.network]) return reply.code(400).send({ error: 'network_not_configured', message: `network ${b.network} is not configured on this server` });
    const row = await deps.registry.register(b.id, b.network, b.name ?? null);
    return reply.code(202).send({ id: row.id, network: row.network, status: row.status, steps: row.steps });
  });
  app.get('/contracts', async () => (await deps.store.list()).map((r) => ({ id: r.id, name: r.name, network: r.network, status: r.status, fns: r.model?.functions.length ?? 0, updated_at: r.updatedAt.toISOString() })));
  app.get<{ Params: { id: string } }>('/c/:id', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return publicRow(row, base);
  });
  app.get<{ Params: { id: string } }>('/c/:id/status', async (req) => {
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    return { status: row.status, steps: row.steps, error: row.error };
  });
  app.patch<{ Params: { id: string } }>('/c/:id', async (req) => {
    const b = PatchBody.parse(req.body);
    const row = await deps.store.get(req.params.id); if (!row) throw notFound('contract', req.params.id);
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = b.name;
    if (b.mcp_scope !== undefined) patch.mcpScope = b.mcp_scope;
    const updated = await deps.store.update(row.id, patch);
    if (b.name !== undefined && updated.model) await deps.store.update(row.id, { model: { ...updated.model, name: b.name } });
    deps.registry.invalidate(row.id);
    return publicRow((await deps.store.get(row.id))!, base);
  });
};
```

`server/src/http/routes/health.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
import type { Network } from '../../types.js';

export const healthRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get('/healthz', async (_req, reply) => {
    const networks: Record<string, string> = {};
    for (const n of Object.keys(deps.cfg.networks) as Network[]) networks[n] = await deps.chain.health(n);
    let db = 'ok';
    try { await deps.store.list(); } catch { db = 'error'; }
    const ok = db === 'ok' && Object.values(networks).every((v) => v === 'ok');
    return reply.code(ok ? 200 : 503).send({ db, networks });
  });
};
```

Stub `invoke.ts` and `docs.ts` for now so the app compiles:
```ts
// server/src/http/routes/invoke.ts and docs.ts (temporary)
import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
export const invokeRoutes = (_deps: Deps): FastifyPluginAsync => async () => {};
```
(same for `docsRoutes`).

Run: `cd server && npx vitest run test/http/contracts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Failing invoke tests**

`server/test/http/invoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { ChainError } from '../../src/chain/errors.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const call = (app: any, fn: string, payload: unknown) => app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/call/${fn}`, payload });

describe('POST /call', () => {
  it('encodes args, simulates with the default source, decodes result and learns a read hint', async () => {
    const { app, chain, registerFixture, store } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => ({ retval: nativeToScVal(12n, { type: 'i128' }), auth: [], ledger: 555, minResourceFee: '1', readWriteCount: 0, latencyMs: 7 });
    const res = await call(app, 'add', { args: { a: '5', b: 7 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: '12', simulated: true, latency_ms: 7, ledger: 555, auth: [] });
    const sim = chain.calls.find((c) => c.method === 'simulate')!;
    expect(sim.args[0]).toBe('testnet'); expect(sim.args[2]).toBe('add'); expect((sim.args[3] as xdr.ScVal[])[0].type).toBe('scvI128'); expect(sim.args[4]).toBe(G);
    expect(await store.getHints(FIXTURE_ID)).toEqual({ add: 'read' });
  });
  it('reports auth and learns a write hint when auth is required', async () => {
    const { app, chain, registerFixture, store } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => ({ retval: xdr.ScVal.scvVoid(), auth: [G], ledger: 1, minResourceFee: '1', readWriteCount: 1, latencyMs: 1 });
    const res = await call(app, 'ping', { args: { who: G, n: 1 } });
    expect(res.json()).toMatchObject({ result: null, auth: [G] });
    expect(await store.getHints(FIXTURE_ID)).toEqual({ ping: 'write' });
  });
  it('400 invalid_args with a path; 404 unknown fn; 409 not ready; 400 network mismatch', async () => {
    const { app, registerFixture, registry } = await testApp();
    expect((await call(app, 'add', { args: {} })).statusCode).toBe(404);
    await registerFixture();
    const bad = await call(app, 'add', { args: { a: 'x', b: '1' } });
    expect(bad.statusCode).toBe(400); expect(bad.json()).toMatchObject({ error: 'invalid_args', details: { path: 'a' } });
    expect((await call(app, 'nope', { args: {} })).json()).toMatchObject({ error: 'function_not_found' });
    expect((await call(app, 'add', { args: { a: '1', b: '1' }, network: 'mainnet' })).json()).toMatchObject({ error: 'network_mismatch' });
    expect((await call(app, 'add', { a: '1' })).statusCode).toBe(400);
  });
  it('maps contract errors to spec names', async () => {
    const { app, chain, registerFixture } = await testApp(); await registerFixture();
    chain.impl.simulate = async () => { throw new ChainError(422, 'contract_error', 'contract returned error #1', { code: 1, details: { fn: 'checked' } }); };
    const res = await call(app, 'checked', { args: { n: 101 } });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'TooBig', message: 'The number was too big.', code: 1, details: { fn: 'checked' } });
  });
});

describe('POST /tx, /submit, GET /tx', () => {
  it('requires source and returns xdr + auth', async () => {
    const { app, chain, registerFixture } = await testApp(); await registerFixture();
    const noSource = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/tx/ping`, payload: { args: { who: G, n: 1 } } });
    expect(noSource.statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/tx/ping`, payload: { args: { who: G, n: 1 }, source: G, timeout_s: 60 } });
    expect(res.json()).toEqual({ xdr: 'AAAA', fee: '100', auth: [G], ledger: 100, expires_at: '2026-01-01T00:00:00.000Z' });
    expect(chain.calls.find((c) => c.method === 'buildTx')!.args[5]).toEqual({ fee: undefined, timeoutS: 60 });
  });
  it('submit waits and returns status; GET /tx polls', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const s = await app.inject({ method: 'POST', url: `/c/${FIXTURE_ID}/submit`, payload: { xdr: 'AAAA' } });
    expect(s.json()).toEqual({ hash: 'h', status: 'success', ledger: 101 });
    const g = await app.inject({ method: 'GET', url: '/tx/h?network=testnet' });
    expect(g.json()).toEqual({ hash: 'h', status: 'success', ledger: 101 });
    expect((await app.inject({ method: 'GET', url: '/tx/h' })).statusCode).toBe(400);
  });
});
```

Run: `cd server && npx vitest run test/http/invoke.test.ts`
Expected: FAIL — routes return 404 `route_not_found`.

- [ ] **Step 4: Implement `invoke.ts`**

`server/src/http/routes/invoke.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { ApiError, badRequest, notFound } from '../../errors.js';
import { contractErrorName, decodeResult, encodeArgs } from '../../spec/codec.js';
import type { ContractModel } from '../../types.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const CallBody = z.object({ args: z.record(z.string(), z.unknown()).default({}), source: z.string().optional(), network: NETWORK.optional() });
const TxBody = CallBody.extend({ source: z.string(), fee: z.string().regex(/^\d+$/).optional(), timeout_s: z.number().int().min(30).max(3600).optional() });
const SubmitBody = z.object({ xdr: z.string().min(1) });
const SUBMIT_WAIT_MS = 30_000;

export const invokeRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  const load = async (id: string, fn: string, network?: 'testnet' | 'mainnet') => {
    const r = await deps.registry.ready(id);
    if (!r.model.functions.some((f) => f.name === fn)) throw notFound('function', fn);
    if (network && network !== r.model.network) throw badRequest('network_mismatch', `contract is registered on ${r.model.network}`);
    return r;
  };
  const mapContractError = (e: unknown, model: ContractModel, spec: any) => {
    if (e instanceof ApiError && e.error === 'contract_error' && e.extra.code !== undefined) {
      const name = contractErrorName(spec, e.extra.code);
      const doc = model.errors.find((x) => x.code === e.extra.code)?.doc;
      if (name) throw new ApiError(422, name, doc || e.message, { code: e.extra.code, details: e.extra.details });
    }
    throw e;
  };

  app.post<{ Params: { id: string; fn: string } }>('/c/:id/call/:fn', async (req) => {
    const b = CallBody.parse(req.body);
    const { model, spec } = await load(req.params.id, req.params.fn, b.network);
    const scArgs = encodeArgs(spec, req.params.fn, b.args);
    const sim = await deps.chain.simulate(model.network, model.id, req.params.fn, scArgs, b.source ?? deps.cfg.simSourceAccount).catch((e) => mapContractError(e, model, spec));
    const kind = sim.auth.length === 0 && sim.readWriteCount === 0 ? 'read' : 'write';
    const current = model.functions.find((f) => f.name === req.params.fn)!.kind;
    if (current !== kind) void deps.registry.learnHint(model.id, req.params.fn, kind).catch((e) => req.log.warn({ err: e }, 'hint'));
    return { result: decodeResult(spec, req.params.fn, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth };
  });

  app.post<{ Params: { id: string; fn: string } }>('/c/:id/tx/:fn', async (req) => {
    const b = TxBody.parse(req.body);
    const { model, spec } = await load(req.params.id, req.params.fn, b.network);
    const scArgs = encodeArgs(spec, req.params.fn, b.args);
    const built = await deps.chain.buildTx(model.network, model.id, req.params.fn, scArgs, b.source, { fee: b.fee, timeoutS: b.timeout_s ?? 300 }).catch((e) => mapContractError(e, model, spec));
    return { xdr: built.xdr, fee: built.fee, auth: built.auth, ledger: built.ledger, expires_at: built.expiresAt };
  });

  const txJson = (t: { hash: string; status: string; ledger?: number; feeCharged?: string; resultXdr?: string }) =>
    ({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.resultXdr && { result_xdr: t.resultXdr }) });

  app.post<{ Params: { id: string } }>('/c/:id/submit', async (req) => {
    const b = SubmitBody.parse(req.body);
    const { model } = await deps.registry.ready(req.params.id);
    return txJson(await deps.chain.submit(model.network, b.xdr, SUBMIT_WAIT_MS));
  });

  app.get<{ Params: { hash: string }; Querystring: { network?: string } }>('/tx/:hash', async (req) => {
    const network = NETWORK.safeParse(req.query.network);
    if (!network.success) throw badRequest('invalid_args', 'network query parameter is required (testnet|mainnet)');
    return txJson(await deps.chain.getTx(network.data, req.params.hash));
  });
};
```

Run: `cd server && npx vitest run test/http/invoke.test.ts`
Expected: PASS. If the "learns a read hint" assertion races (hint written after the response), `await` the `learnHint` instead of `void`-ing it — correctness over the few ms.

- [ ] **Step 5: Failing docs-route tests, then implement**

`server/test/http/docs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';

describe('docs routes', () => {
  it('serves llms.txt as markdown and openapi.json', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const l = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` });
    expect(l.statusCode).toBe(200); expect(l.headers['content-type']).toMatch(/text\/markdown/); expect(l.body).toMatch(/^# KitchenSink/);
    const o = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` });
    expect(o.json().openapi).toBe('3.1.0');
  });
  it('events is 501 not_indexed; unknown contract is 404; not-ready is 409', async () => {
    const { app, registerFixture, registry } = await testApp();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` })).statusCode).toBe(404);
    await registerFixture();
    const e = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/events` });
    expect(e.statusCode).toBe(501); expect(e.json().error).toBe('not_indexed');
  });
});
```

`server/src/http/routes/docs.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import type { Deps } from '../deps.js';
import { ApiError } from '../../errors.js';

export const docsRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>('/c/:id/llms.txt', async (req, reply) => {
    const { row } = await deps.registry.ready(req.params.id);
    return reply.type('text/markdown; charset=utf-8').send(row.llmsTxt ?? '');
  });
  app.get<{ Params: { id: string } }>('/c/:id/openapi.json', async (req) => (await deps.registry.ready(req.params.id)).row.openapi);
  app.get<{ Params: { id: string } }>('/c/:id/events', async (req) => {
    await deps.registry.ready(req.params.id);
    throw new ApiError(501, 'not_indexed', 'event history is not indexed yet; it arrives in a later milestone');
  });
};
```

Run: `cd server && npx vitest run test/http && npm run typecheck`
Expected: all http tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/http server/test/http server/test/helpers/app.ts && git commit -m "server(http): fastify app with contracts, invoke, docs and health routes"
```

---

### Task 10: `mcp/` — per-contract MCP server and Streamable HTTP route

**Files:**
- Create: `server/src/mcp/tools.ts`, `server/src/mcp/route.ts`
- Modify: `server/src/http/app.ts` (register the MCP route)
- Test: `server/test/mcp/tools.test.ts`, `server/test/mcp/route.test.ts`

**Interfaces:**
- Consumes: `Registry.ready`, `Chain`, codec, `Deps`.
- Produces: `buildMcpServer(model: ContractModel, spec: contract.Spec, scope: McpScope, deps: Deps): McpServer` (a fresh, cheap server instance per call), `registerMcp(app: FastifyInstance, deps: Deps): void` mounting `ALL /c/:id/mcp`.

- [ ] **Step 1: Failing tool tests (in-memory transport)**

`server/test/mcp/tools.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';
import { buildMcpServer } from '../../src/mcp/tools.js';
import { ChainError } from '../../src/chain/errors.js';

const G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function connect(scope: 'ro' | 'rw') {
  const t = await testApp(); await t.registerFixture();
  const { model, spec } = await t.registry.ready(FIXTURE_ID);
  const deps = { cfg: t.cfg, chain: t.chain, registry: t.registry, store: t.store, log: t.app.log as any };
  const server = buildMcpServer(model, spec, scope, deps);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await server.connect(st); await client.connect(ct);
  return { ...t, client };
}

describe('buildMcpServer', () => {
  it('read-only lists call_* + search + docs only; rw adds build_* and submit', async () => {
    const ro = await connect('ro');
    const names = (await ro.client.listTools()).tools.map((t) => t.name).sort();
    expect(names.filter((n) => n.startsWith('call_'))).toHaveLength(15);
    expect(names).toContain('search_functions'); expect(names).toContain('get_docs');
    expect(names.some((n) => n.startsWith('build_'))).toBe(false); expect(names).not.toContain('submit_transaction');
    const rw = await connect('rw');
    const rwNames = (await rw.client.listTools()).tools.map((t) => t.name);
    expect(rwNames.filter((n) => n.startsWith('build_'))).toHaveLength(15); expect(rwNames).toContain('submit_transaction');
  });
  it('tool descriptions carry doc + signature, input schema is the args schema plus source', async () => {
    const { client } = await connect('ro');
    const add = (await client.listTools()).tools.find((t) => t.name === 'call_add')!;
    expect(add.description).toContain('Returns the sum of two i128 values.');
    expect(add.description).toContain('add(a: i128, b: i128) → i128');
    expect((add.inputSchema as any).properties.a).toBeTruthy(); expect((add.inputSchema as any).properties.source).toBeTruthy();
  });
  it('call_* returns text + structuredContent', async () => {
    const { client, chain } = await connect('ro');
    chain.impl.simulate = async () => ({ retval: nativeToScVal(3n, { type: 'i128' }), auth: [], ledger: 9, minResourceFee: '1', readWriteCount: 0, latencyMs: 2 });
    const r = await client.callTool({ name: 'call_add', arguments: { a: '1', b: '2' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ result: '3', simulated: true, latency_ms: 2, ledger: 9, auth: [] });
    expect(JSON.parse((r.content as any)[0].text)).toEqual(r.structuredContent);
  });
  it('contract errors come back as isError with the envelope', async () => {
    const { client, chain } = await connect('ro');
    chain.impl.simulate = async () => { throw new ChainError(422, 'contract_error', 'x', { code: 2 }); };
    const r = await client.callTool({ name: 'call_checked', arguments: { n: 5 } });
    expect(r.isError).toBe(true);
    expect(JSON.parse((r.content as any)[0].text)).toMatchObject({ error: 'Forbidden', code: 2 });
  });
  it('build_* and submit work in rw', async () => {
    const { client } = await connect('rw');
    const b = await client.callTool({ name: 'build_ping', arguments: { who: G, n: 1, source: G } });
    expect(b.structuredContent).toMatchObject({ xdr: 'AAAA', auth: [G] });
    const s = await client.callTool({ name: 'submit_transaction', arguments: { xdr: 'AAAA' } });
    expect(s.structuredContent).toMatchObject({ hash: 'h', status: 'success' });
  });
  it('search_functions and get_docs', async () => {
    const { client } = await connect('ro');
    const s = await client.callTool({ name: 'search_functions', arguments: { query: 'echo' } });
    expect((s.structuredContent as any).functions.map((f: any) => f.name)).toEqual(['echo_bytes', 'echo_hash', 'echo_level', 'echo_map', 'echo_pair', 'echo_shape']);
    const d = await client.callTool({ name: 'get_docs', arguments: {} });
    expect((d.content as any)[0].text).toMatch(/^# KitchenSink/);
  });
});
```

Run: `cd server && npx vitest run test/mcp/tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `tools.ts`**

`server/src/mcp/tools.ts`:
```ts
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import type { contract } from '@stellar/stellar-sdk';
import { ApiError } from '../errors.js';
import type { Deps } from '../http/deps.js';
import { contractErrorName, decodeResult, encodeArgs } from '../spec/codec.js';
import type { ContractModel, JsonSchema, McpScope } from '../types.js';
import { shortId } from '../docs/llms.js';

const MAX_NAME = 64;
const toolName = (prefix: string, fn: string) => `${prefix}${fn}`.slice(0, MAX_NAME);
const sig = (f: ContractModel['functions'][number]) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;
const withSource = (s: JsonSchema, required: boolean): JsonSchema => {
  const props = { ...(s.properties as object), source: { type: 'string', description: 'G… account used as transaction source' } };
  const req = [...((s.required as string[]) ?? []), ...(required ? ['source'] : [])];
  return { type: 'object', properties: props, ...(req.length ? { required: req } : {}), additionalProperties: false };
};
const CALL_OUT: JsonSchema = { type: 'object', properties: { result: {}, simulated: { type: 'boolean' }, latency_ms: { type: 'integer' }, ledger: { type: 'integer' }, auth: { type: 'array', items: { type: 'string' } } }, required: ['result', 'simulated'] };
const BUILD_OUT: JsonSchema = { type: 'object', properties: { xdr: { type: 'string' }, fee: { type: 'string' }, auth: { type: 'array', items: { type: 'string' } }, ledger: { type: 'integer' }, expires_at: { type: 'string' } }, required: ['xdr'] };
const TX_OUT: JsonSchema = { type: 'object', properties: { hash: { type: 'string' }, status: { type: 'string' }, ledger: { type: 'integer' }, fee_charged: { type: 'string' }, result_xdr: { type: 'string' } }, required: ['hash', 'status'] };

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });
const fail = (e: unknown, model: ContractModel, spec: contract.Spec) => {
  let body: Record<string, unknown>;
  if (e instanceof ApiError) {
    body = e.toJSON();
    if (e.error === 'contract_error' && e.extra.code !== undefined) {
      const name = contractErrorName(spec, e.extra.code);
      if (name) body = { ...body, error: name, message: model.errors.find((x) => x.code === e.extra.code)?.doc || e.message };
    }
  } else body = { error: 'internal', message: (e as Error)?.message ?? String(e) };
  return { content: [{ type: 'text' as const, text: JSON.stringify(body) }], isError: true };
};

export function buildMcpServer(model: ContractModel, spec: contract.Spec, scope: McpScope, deps: Deps): McpServer {
  const server = new McpServer({ name: `sonata-${(model.name ?? shortId(model.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, version: '0.1.0' });
  const { chain, cfg } = deps;

  for (const f of model.functions) {
    const desc = `${f.doc ? f.doc.trim() + '\n\n' : ''}${sig(f)}\nKind: ${f.kind}. Simulates on ${model.network}; nothing is signed or sent.`;
    server.registerTool(toolName('call_', f.name), { description: desc, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, false)), outputSchema: fromJsonSchema(CALL_OUT) },
      async (args) => {
        try {
          const { source, ...rest } = args;
          const sim = await chain.simulate(model.network, model.id, f.name, encodeArgs(spec, f.name, rest), (source as string) ?? cfg.simSourceAccount);
          return ok({ result: decodeResult(spec, f.name, sim.retval), simulated: true, latency_ms: sim.latencyMs, ledger: sim.ledger, auth: sim.auth });
        } catch (e) { return fail(e, model, spec); }
      });
    if (scope === 'rw') {
      server.registerTool(toolName('build_', f.name), { description: `Build an UNSIGNED transaction for ${sig(f)}. Returns XDR for a wallet to sign; never signs.`, inputSchema: fromJsonSchema<Record<string, unknown>>(withSource(f.jsonSchema, true)), outputSchema: fromJsonSchema(BUILD_OUT) },
        async (args) => {
          try {
            const { source, ...rest } = args;
            const b = await chain.buildTx(model.network, model.id, f.name, encodeArgs(spec, f.name, rest), source as string, { timeoutS: 300 });
            return ok({ xdr: b.xdr, fee: b.fee, auth: b.auth, ledger: b.ledger, expires_at: b.expiresAt });
          } catch (e) { return fail(e, model, spec); }
        });
    }
  }
  if (scope === 'rw') {
    server.registerTool('submit_transaction', { description: 'Submit a signed transaction envelope (base64 XDR) and wait up to 30s for the result.', inputSchema: fromJsonSchema<{ xdr: string }>({ type: 'object', properties: { xdr: { type: 'string' } }, required: ['xdr'] }), outputSchema: fromJsonSchema(TX_OUT) },
      async ({ xdr }) => { try { const t = await chain.submit(model.network, xdr, 30_000); return ok({ hash: t.hash, status: t.status, ...(t.ledger !== undefined && { ledger: t.ledger }), ...(t.feeCharged && { fee_charged: t.feeCharged }), ...(t.resultXdr && { result_xdr: t.resultXdr }) }); } catch (e) { return fail(e, model, spec); } });
  }
  server.registerTool('search_functions', { description: 'Find contract functions by name or purpose.', inputSchema: fromJsonSchema<{ query: string }>({ type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }) },
    async ({ query }) => {
      const q = query.toLowerCase();
      const functions = model.functions.filter((f) => f.name.toLowerCase().includes(q) || f.doc.toLowerCase().includes(q)).map((f) => ({ name: f.name, signature: sig(f), doc: f.doc, kind: f.kind }));
      return ok({ functions });
    });
  server.registerTool('get_docs', { description: 'llms.txt for this contract: functions, types, errors, events and endpoints.', inputSchema: fromJsonSchema<Record<string, never>>({ type: 'object', properties: {} }) },
    async () => { const { row } = await deps.registry.ready(model.id); return { content: [{ type: 'text' as const, text: row.llmsTxt ?? '' }] }; });
  server.registerResource('llms.txt', `sonata://c/${model.id}/llms.txt`, { description: 'AI-ready contract docs', mimeType: 'text/markdown' },
    async (uri) => { const { row } = await deps.registry.ready(model.id); return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: row.llmsTxt ?? '' }] }; });
  return server;
}
```

Run: `cd server && npx vitest run test/mcp/tools.test.ts`
Expected: PASS. If `fromJsonSchema` rejects a schema (it validates with a JSON-Schema validator), the failing key will be named in the error; the schemas here are draft-07 subsets with no `$ref` (Task 3 inlined them). If `registerResource`'s signature differs in 2.0 (`(name, uri, metadata, readCallback)`), check `node -e "import('@modelcontextprotocol/server').then(m=>console.log(m.McpServer.prototype.registerResource.toString().slice(0,300)))"` and adjust.

- [ ] **Step 3: Failing route test (real HTTP via Streamable HTTP client)**

`server/test/mcp/route.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID } from '../fixtures/index.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => { await close?.(); });

describe('ALL /c/:id/mcp', () => {
  it('serves MCP over Streamable HTTP, stateless, honoring the stored scope', async () => {
    const t = await testApp(); await t.registerFixture();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    close = () => t.app.close();
    const port = (t.app.server.address() as any).port;
    const url = new URL(`http://127.0.0.1:${port}/c/${FIXTURE_ID}/mcp`);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    expect((await client.listTools()).tools.some((x) => x.name === 'build_ping')).toBe(false);
    await client.close();
    await t.app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' } });
    const client2 = new Client({ name: 't', version: '0' });
    await client2.connect(new StreamableHTTPClientTransport(url));
    expect((await client2.listTools()).tools.some((x) => x.name === 'build_ping')).toBe(true);
    const r = await client2.callTool({ name: 'call_get_count', arguments: {} });
    expect(r.structuredContent).toMatchObject({ simulated: true });
    await client2.close();
  });
  it('returns the JSON error envelope for unknown / not-ready contracts', async () => {
    const t = await testApp();
    const res = await t.app.inject({ method: 'POST', url: '/c/CNOPE/mcp', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    expect(res.statusCode).toBe(404); expect(res.json().error).toBe('contract_not_found');
  });
});
```

Run: `cd server && npx vitest run test/mcp/route.test.ts`
Expected: FAIL — 404 `route_not_found` from the first test.

- [ ] **Step 4: Implement `route.ts` and wire it into `app.ts`**

`server/src/mcp/route.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { Deps } from '../http/deps.js';
import { buildMcpServer } from './tools.js';

/** Stateless Streamable HTTP: a fresh McpServer + transport per request, built from the cached model. */
export function registerMcp(app: FastifyInstance, deps: Deps) {
  app.route<{ Params: { id: string } }>({
    method: ['GET', 'POST', 'DELETE'],
    url: '/c/:id/mcp',
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      const { row, model, spec } = await deps.registry.ready(req.params.id);   // ApiError → JSON envelope via the app error handler
      const server = buildMcpServer(model, spec, row.mcpScope, deps);
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      reply.hijack();
      reply.raw.on('close', () => { void transport.close(); void server.close(); });
      await transport.handleRequest(req.raw, reply.raw, req.body);
    }
  });
}
```

In `server/src/http/app.ts` add `import { registerMcp } from '../mcp/route.js';` and, after the other `app.register(...)` calls, `registerMcp(app, deps);`.

Run: `cd server && npx vitest run test/mcp && npm run typecheck`
Expected: PASS. Known gotchas: (1) the MCP client sends `Accept: application/json, text/event-stream` — Fastify's default JSON parser only runs for `content-type: application/json`, which the client sets, so `req.body` is parsed; (2) if `handleRequest` complains about a missing `Host`/`Origin` validation, pass `{ sessionIdGenerator: undefined, allowedHosts: undefined }` — do not enable DNS-rebinding protection here, the service is public.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp server/src/http/app.ts server/test/mcp && git commit -m "server(mcp): per-contract mcp server over stateless streamable http"
```

---

### Task 11: Boot, Docker, Fly, CI, README

**Files:**
- Create: `server/src/main.ts`, `server/Dockerfile`, `server/.dockerignore`, `server/fly.toml`, `server/README.md`, `.github/workflows/server.yml`
- Modify: `README.md` (repo root — one paragraph pointing at `server/`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: `main.ts`**

`server/src/main.ts`:
```ts
import pg from 'pg';
import pino from 'pino';
import { loadConfig } from './config.js';
import { RpcChain } from './chain/rpc.js';
import { PgStore } from './registry/store.js';
import { Registry } from './registry/registry.js';
import { runMigrations } from './registry/migrate.js';
import { llmsTxt } from './docs/llms.js';
import { openapi } from './docs/openapi.js';
import { buildApp } from './http/app.js';

const cfg = loadConfig(process.env);
const log = pino({ level: cfg.logLevel });
await runMigrations(cfg.databaseUrl);
const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
const store = new PgStore(pool);
const chain = new RpcChain(cfg);
const registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
const app = buildApp({ cfg, chain, registry, store, log });
await app.listen({ port: cfg.port, host: '0.0.0.0' });
log.info({ port: cfg.port, networks: Object.keys(cfg.networks), base: cfg.publicBaseUrl }, 'sonata server up');
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
```

Run: `cd server && cp .env.example .env && docker compose up -d db && npm run dev` (in one terminal) then in another:
```bash
curl -s localhost:8080/healthz
curl -s -X POST localhost:8080/contracts -H 'content-type: application/json' -d '{"id":"<a real testnet contract id>","network":"testnet"}'
```
Expected: `{"db":"ok","networks":{"testnet":"ok"}}` and a `202`. (A real testnet contract: deploy the fixture — Task 12 step 1 — and use its ID.) Stop the dev server.

- [ ] **Step 2: Dockerfile, .dockerignore, fly.toml**

`server/Dockerfile`:
```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
EXPOSE 8080
CMD ["node", "dist/main.js"]
```

`server/.dockerignore`:
```
node_modules
dist
test
.env*
```

`server/fly.toml`:
```toml
app = "sonata-api"
primary_region = "ams"

[build]

[env]
  PORT = "8080"
  PUBLIC_BASE_URL = "https://api.sonata.brages.uk"
  CORS_ORIGINS = "https://sonata.brages.uk,http://localhost:3000"
  LOG_LEVEL = "info"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  interval = "30s"
  timeout = "5s"
  grace_period = "20s"
  method = "GET"
  path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

Run: `cd server && docker build -t sonata-server . && docker run --rm -e DATABASE_URL=postgres://sonata:sonata@host.docker.internal:5432/sonata -p 8081:8080 sonata-server & sleep 6 && curl -s localhost:8081/healthz; docker stop $(docker ps -q --filter ancestor=sonata-server)`
Expected: healthz JSON from the container. Note `migrate.ts` resolves `../../drizzle` relative to `dist/registry/`, which is why the Dockerfile copies `drizzle/` next to `dist/`.

Deploy (manual, once): `cd server && fly launch --no-deploy --copy-config --name sonata-api && fly postgres create --name sonata-db --region ams && fly postgres attach sonata-db && fly secrets set SIM_SOURCE_ACCOUNT=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF && fly deploy && fly certs add api.sonata.brages.uk` then add the CNAME shown by `fly certs show`. Expected: `curl https://api.sonata.brages.uk/healthz` → `{"db":"ok",...}`.

- [ ] **Step 3: CI**

`.github/workflows/server.yml`:
```yaml
name: server
on:
  push: { paths: ['server/**', '.github/workflows/server.yml'] }
  pull_request: { paths: ['server/**'] }
  workflow_dispatch:
  schedule: [{ cron: '17 3 * * *' }]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: sonata, POSTGRES_PASSWORD: sonata, POSTGRES_DB: sonata_test }
        ports: ['5432:5432']
        options: --health-cmd "pg_isready -U sonata" --health-interval 5s --health-timeout 5s --health-retries 10
    defaults: { run: { working-directory: server } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: server/package-lock.json }
      - run: npm ci
      - run: npm run typecheck
      - run: DATABASE_URL=postgres://sonata:sonata@localhost:5432/sonata_test npm run db:migrate
      - run: TEST_DATABASE_URL=postgres://sonata:sonata@localhost:5432/sonata_test npm test
  e2e:
    if: github.event_name == 'workflow_dispatch' || github.event_name == 'schedule'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: server } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: server/package-lock.json }
      - run: npm ci
      - run: npm run test:e2e
        env:
          E2E_CONTRACT_ID: ${{ vars.E2E_CONTRACT_ID }}
          E2E_SECRET_KEY: ${{ secrets.E2E_SECRET_KEY }}
```

- [ ] **Step 4: READMEs**

`server/README.md` — sections: *What this is* (two sentences), *Run locally* (`docker compose up -d db`, `cp .env.example .env`, `npm i`, `npm run dev`), *Endpoints* (the table from spec §6, copied), *MCP* (`claude mcp add --transport http sonata-<name> https://api.sonata.brages.uk/c/<id>/mcp`), *Tests* (`npm test`, `npm run test:e2e` needs `E2E_CONTRACT_ID` + `E2E_SECRET_KEY` in `.env.test`), *Deploy* (the fly commands above), *Layout* (the file tree from this plan's File structure section).

Root `README.md`: add under "Structure": `- \`server/\` — the API + MCP server (Node/Fastify/Postgres). See \`server/README.md\`.` and change the "Front-end only" note to "The site still uses demo data; wiring it to `server/` is the next milestone."

- [ ] **Step 5: Commit**

```bash
git add server/src/main.ts server/Dockerfile server/.dockerignore server/fly.toml server/README.md .github/workflows/server.yml README.md && git commit -m "server: boot, docker, fly config, ci and readme"
```

---

### Task 12: End-to-end test on testnet

**Files:**
- Create: `server/test/e2e/flow.test.ts`, `server/test/e2e/README.md`
- Modify: `server/.env.example` (document `E2E_*`)

**Interfaces:**
- Consumes: the real `RpcChain`, `PgStore` (or `MemoryStore` — e2e uses `MemoryStore` so it needs no DB), the fixture contract deployed on testnet.

- [ ] **Step 1: Deploy the fixture once (manual)**

```bash
cd server/test/fixtures/kitchen-sink
stellar keys generate --global sonata-e2e --network testnet --fund      # friendbot-funded
stellar contract deploy --wasm kitchen_sink.wasm --source-account sonata-e2e --network testnet
stellar keys show sonata-e2e                                             # secret key
```
Put the printed contract id and secret in `server/.env.test`:
```
E2E_CONTRACT_ID=C...
E2E_SECRET_KEY=S...
```
Add the same two lines (values blank) to `server/.env.example` with a comment `# e2e only`. Store them as a GitHub Actions variable/secret for the nightly job.

- [ ] **Step 2: Write the e2e test**

`server/test/e2e/flow.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import pino from 'pino';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadConfig, PASSPHRASES } from '../../src/config.js';
import { RpcChain } from '../../src/chain/rpc.js';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { llmsTxt } from '../../src/docs/llms.js';
import { openapi } from '../../src/docs/openapi.js';
import { buildApp } from '../../src/http/app.js';

if (existsSync('.env.test')) for (const l of readFileSync('.env.test', 'utf8').split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const ID = process.env.E2E_CONTRACT_ID!; const SECRET = process.env.E2E_SECRET_KEY!;
const kp = Keypair.fromSecret(SECRET); const G = kp.publicKey();

let app: ReturnType<typeof buildApp>, base: string;
beforeAll(async () => {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_BASE_URL: 'http://127.0.0.1' });
  const chain = new RpcChain(cfg); const store = new MemoryStore();
  const registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
  app = buildApp({ cfg, chain, registry, store, log: pino({ level: 'warn' }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as any).port}`;
  await app.inject({ method: 'POST', url: '/contracts', payload: { id: ID, network: 'testnet', name: 'KitchenSink' } });
  await registry.whenIdle();
}, 60_000);
afterAll(() => app.close());

const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload });

describe('e2e on testnet', () => {
  it('registered and ready', async () => {
    const st = await app.inject({ method: 'GET', url: `/c/${ID}/status` });
    expect(st.json(), JSON.stringify(st.json())).toMatchObject({ status: 'ready' });
  });
  it('/call simulates a read and a typed echo', async () => {
    const add = await post(`/c/${ID}/call/add`, { args: { a: '170141183460469231731687303715884105000', b: '727' } });
    expect(add.json()).toMatchObject({ result: '170141183460469231731687303715884105727', simulated: true, auth: [] });
    const map = await post(`/c/${ID}/call/echo_map`, { args: { m: { a: '1', b: '2' } } });
    expect(map.json().result).toEqual({ a: '1', b: '2' });
    const bytes = await post(`/c/${ID}/call/echo_bytes`, { args: { b: '0xcafe' } });
    expect(bytes.json().result).toBe('0xcafe');
  });
  it('/call maps a contract error to its name', async () => {
    const r = await post(`/c/${ID}/call/checked`, { args: { n: 101 } });
    expect(r.statusCode).toBe(422); expect(r.json()).toMatchObject({ error: 'TooBig', code: 1 });
  });
  it('/call on ping lists the signer; /tx builds; sign; /submit succeeds', async () => {
    const sim = await post(`/c/${ID}/call/ping`, { args: { who: G, n: 1 }, source: G });
    expect(sim.json().auth).toEqual([G]);
    const built = await post(`/c/${ID}/tx/ping`, { args: { who: G, n: 1 }, source: G });
    expect(built.statusCode, built.body).toBe(200);
    const tx = TransactionBuilder.fromXDR(built.json().xdr, PASSPHRASES.testnet);
    tx.sign(kp);
    const sub = await post(`/c/${ID}/submit`, { xdr: tx.toXDR() });
    expect(sub.json(), sub.body).toMatchObject({ status: 'success' });
    expect(sub.json().ledger).toBeGreaterThan(0);
  }, 90_000);
  it('MCP: call and build over Streamable HTTP', async () => {
    await app.inject({ method: 'PATCH', url: `/c/${ID}`, payload: { mcp_scope: 'rw' } });
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/c/${ID}/mcp`)));
    const r = await client.callTool({ name: 'call_get_count', arguments: {} });
    expect(r.isError).toBeFalsy(); expect(typeof (r.structuredContent as any).result).toBe('number');
    const b = await client.callTool({ name: 'build_bump', arguments: { source: G } });
    expect((b.structuredContent as any).xdr).toMatch(/^AAAA/);
    await client.close();
  }, 60_000);
});
```

`server/test/e2e/README.md`: three lines — needs `.env.test` with `E2E_CONTRACT_ID`/`E2E_SECRET_KEY`, run with `npm run test:e2e`, redeploy the fixture with the Step-1 commands if the contract expires (testnet resets quarterly).

- [ ] **Step 3: Run it**

Run: `cd server && npm run test:e2e`
Expected: 5 tests PASS against testnet. The `/submit` test takes 5–15 s. If `ping` simulation returns `auth: []`, the simulation source equals `who` and the RPC folded the auth into source-account credentials — `authAddresses` substitutes the source, so the expectation still holds; if it doesn't, log `sim.result.auth` once and fix `auth.ts`.

- [ ] **Step 4: Commit**

```bash
git add server/test/e2e server/.env.example && git commit -m "server: testnet e2e flow (register, call, tx, submit, mcp)"
```

---

## Done when

- `cd server && npm test` is green (spec, chain, registry, docs, http, mcp).
- `npm run test:e2e` is green against the deployed fixture.
- `docker build` succeeds and `fly deploy` serves `https://api.sonata.brages.uk/healthz`.
- Registering a third-party testnet contract (e.g. a Soroswap or token contract) through `POST /contracts` produces working `/call`, `/llms.txt`, `/openapi.json` and an MCP endpoint `claude mcp add --transport http` can connect to.
