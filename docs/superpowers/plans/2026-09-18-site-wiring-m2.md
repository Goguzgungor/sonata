# Sonata Site Wiring (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Next.js site's Register, Contracts, workspace (Overview/Functions/MCP/Docs) and public contract page run against the real M1 API instead of demo data.

**Architecture:** A framework-free `lib/api.js` (fetch wrapper + endpoint helpers + `ApiError`) and two hooks (`useApi`, `usePoll`) feed the existing client-only screens; `<Async>` standardises loading/error; the workspace moves to `/c/[id]/[tab]`. Demo screens keep their data behind a per-screen `<PreviewBar />`. Unit tests cover the lib layer with vitest; one Playwright flow covers the integrated path.

**Tech Stack:** Next.js 15 App Router (JS/JSX, `@/` alias from `jsconfig.json`), React 19, the client-only `@sonata/ui` bundle (`useSonataUI()` returns `null` until mount), vitest 5 + jsdom + @testing-library/react 16, @playwright/test 1.63.

**Spec:** `docs/superpowers/specs/2026-09-18-site-wiring-m2-design.md` (binding). API contract: `docs/superpowers/specs/2026-09-17-sonata-server-core-engine-design.md` §6/§7/§14.

## Global Constraints

- Root package is the Next.js site (no `"type": "module"`); source files are `.js`/`.jsx`; keep `'use client'` at the top of every screen/hook file that touches `window`/hooks; every screen returns `null` until `useSonataUI()` resolves (existing pattern — keep it).
- `NEXT_PUBLIC_API_URL` is the only new env var; default `http://localhost:8080`; strip trailing slashes.
- API response shapes (from the server spec, verbatim): `GET /contracts` → `[{ id, name, network, status, fns, updated_at }]`; `GET /c/:id` → `{ id, network, name, wasmHash, specLedger, functions: [{ name, doc, inputs: [{name,type}], output, kind: 'read'|'write'|'unknown', jsonSchema }], types, errors: [{code,name,doc}], events, mcp_scope: 'ro'|'rw', status: 'queued'|'running'|'ready'|'failed', steps: [{ name: 'fetch'|'parse'|'generate'|'index', status: 'queued'|'running'|'done'|'skipped'|'failed', detail, error? }], error, urls: { mcp, llms, openapi }, created_at, updated_at }`; `POST /contracts {id, network, name?}` → 202 `{ id, network, status, steps }`; `GET /c/:id/status` → `{ status, steps, error }`; `PATCH /c/:id {name?, mcp_scope?}` → same as GET; `POST /c/:id/call/:fn {args, source?}` → `{ result, simulated: true, latency_ms, ledger, auth: string[] }`; `POST /c/:id/tx/:fn {args, source, fee?, timeout_s?}` → `{ xdr, fee, auth, ledger, expires_at }`; errors are `{ error, message, code?, details? }` with 400 `invalid_args` (`details.path`), 400 `invalid_contract_id`, 400 `network_not_configured`, 404 `contract_not_found`, 409 `contract_not_ready` (`details.steps`), 422 `<ErrorName>`/`contract_error`/`host_error`, 502 `rpc_unavailable`.
- Validation regexes: contract id `/^C[A-Z2-7]{55}$/`, account id `/^G[A-Z2-7]{55}$/`. `shortId(id) = id.slice(0,4) + '…' + id.slice(-4)`.
- No new runtime dependencies. Dev dependencies pinned: `vitest@^5.0.0`, `jsdom@^30.0.0`, `@testing-library/react@^16.3.0`, `@vitejs/plugin-react@^6.0.0`, `@playwright/test@^1.63.0`.
- Chip tones available in the kit: `neutral`, `good`, `warning`, `bad`, `inverse`. Kit components and props: `Button({variant, size, arrow, fullWidth, type, ...rest})` (so `disabled`/`onClick` pass through), `Chip({tone})`, `Field({label, hint, action, onAction, mono, invalid, id, ...rest})` (rest → the `<input>`: `value`, `onChange`, `placeholder`, `type`), `Segmented({options, value, onChange, ariaLabel})`, `Tabs({items, active, onChange})`, `Stat({label, value, unit, note})`, `KeyValueList({rows})` (row `{key, value, mono?}`), `DataTable({columns, rows})`, `Numeral({index})`. Existing helpers in `components/ui.jsx`: `CopyButton`, `Label`, `CodeBox`, `ResponsiveTable`; in `lib/sonata.js`: `useSonataUI`, `copyText`, `download`.
- The testnet fixture for the Playwright flow is `CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP` (16 functions incl. `add`, `ping`, `get_count`).
- Commit after every task with a conventional message; run `npm test` (vitest) and `npm run build` before every commit — the build is the only type/import check the site has.

---

## File structure

```
lib/api.js                 API_URL, ApiError, api(), contracts.*, shortId, isContractId, isAccountId
lib/useApi.js              useApi(fetcher, deps), usePoll(fetcher, opts)
lib/args.js                placeholderFor(schema), fieldKind(schema), coerceArgs(inputs, values) → { args, errors }
components/Async.jsx       <Async loading error onRetry skeleton>
components/PreviewBar.jsx  the banner (moved out of TopNav)
components/TopNav.jsx      banner + fake wallet removed
components/screens/Register.jsx, Contracts.jsx, ContractPublic.jsx        live
components/workspace/Workspace.jsx, Overview.jsx, Functions.jsx, Mcp.jsx, Docs.jsx   live
components/workspace/History.jsx   unchanged + <PreviewBar />
components/screens/Explorer.jsx, Flows.jsx, FlowDetail.jsx, Keys.jsx, Welcome.jsx   + <PreviewBar />
app/c/[id]/[tab]/page.jsx, app/c/[id]/page.jsx   new (app/c/[tab]/ deleted)
app/explorer/[id]/page.jsx   live metadata + fallback
components/data.js           demo constants pruned to what demo screens use
test/site/api.test.js, useApi.test.js, args.test.js
e2e/site.spec.ts, playwright.config.js
vitest.config.mjs, .env.example, .github/workflows/site.yml, README.md
```

---

### Task 1: vitest setup + `lib/api.js`

**Files:**
- Create: `lib/api.js`, `vitest.config.mjs`, `test/site/api.test.js`, `.env.example`
- Modify: `package.json` (scripts + devDependencies), `.gitignore` (add `test-results/`, `playwright-report/`)

**Interfaces:**
- Produces: `API_URL`, `class ApiError extends Error { status, error, code, details }`, `api(path, { method, body, signal, text })`, `contracts.{list, register, get, status, patch, call, tx, llms, urls}`, `shortId`, `isContractId`, `isAccountId`.

- [ ] **Step 1: Tooling**

`package.json` additions:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
},
"devDependencies": {
  "@playwright/test": "^1.63.0",
  "@testing-library/react": "^16.3.0",
  "@vitejs/plugin-react": "^6.0.0",
  "jsdom": "^30.0.0",
  "vitest": "^5.0.0"
}
```

`vitest.config.mjs`:
```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { include: ['test/site/**/*.test.{js,jsx}'], environment: 'jsdom' }
});
```

`.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:8080
```

Run: `npm install`
Expected: installs cleanly.

- [ ] **Step 2: Failing tests**

`test/site/api.test.js`:
```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, contracts, API_URL, shortId, isContractId, isAccountId } from '@/lib/api';

const ID = 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('GETs JSON from API_URL', async () => {
    fetch.mockResolvedValue(json(200, { ok: 1 }));
    expect(await api('/contracts')).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith(API_URL + '/contracts', expect.objectContaining({ method: 'GET' }));
  });
  it('POSTs a JSON body', async () => {
    fetch.mockResolvedValue(json(202, { id: ID, status: 'queued', steps: [] }));
    await contracts.register(ID, 'testnet', 'KS');
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ id: ID, network: 'testnet', name: 'KS' });
  });
  it('maps the error envelope to ApiError', async () => {
    fetch.mockResolvedValue(json(422, { error: 'TooBig', message: 'The number was too big.', code: 1, details: { fn: 'checked' } }));
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, error: 'TooBig', message: 'The number was too big.', code: 1, details: { fn: 'checked' } });
  });
  it('non-JSON error bodies still become ApiError', async () => {
    fetch.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    const err = await api('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 502, error: 'http_502' });
  });
  it('network failure is ApiError status 0 naming the API URL', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await api('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 0, error: 'network' });
    expect(err.message).toContain(API_URL);
  });
  it('text mode returns the body as text', async () => {
    fetch.mockResolvedValue(new Response('# Hi', { status: 200, headers: { 'content-type': 'text/markdown' } }));
    expect(await contracts.llms(ID)).toBe('# Hi');
  });
  it('call/tx send args and source', async () => {
    fetch.mockResolvedValue(json(200, {}));
    await contracts.call(ID, 'add', { a: '1', b: '2' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ args: { a: '1', b: '2' } });
    await contracts.tx(ID, 'ping', { who: 'G', n: 1 }, 'GSRC', { timeout_s: 60 });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ args: { who: 'G', n: 1 }, source: 'GSRC', timeout_s: 60 });
    expect(fetch.mock.calls[1][0]).toBe(`${API_URL}/c/${ID}/tx/ping`);
  });
});

describe('helpers', () => {
  it('urls are pure', () => {
    expect(contracts.urls(ID)).toEqual({ base: `${API_URL}/c/${ID}`, mcp: `${API_URL}/c/${ID}/mcp`, llms: `${API_URL}/c/${ID}/llms.txt`, openapi: `${API_URL}/c/${ID}/openapi.json` });
  });
  it('shortId and validators', () => {
    expect(shortId(ID)).toBe('CADY…ULTP');
    expect(isContractId(ID)).toBe(true); expect(isContractId('nope')).toBe(false);
    expect(isAccountId('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF')).toBe(true); expect(isAccountId(ID)).toBe(false);
  });
});
```

Run: `npx vitest run test/site/api.test.js`
Expected: FAIL — cannot resolve `@/lib/api`.

- [ ] **Step 3: Implement `lib/api.js`**

```js
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    this.status = status; this.error = error; this.code = extra.code; this.details = extra.details;
  }
}

/** JSON in/out against the Sonata API. Non-2xx → ApiError from the server envelope; fetch failure → ApiError(0, 'network'). */
export async function api(path, { method = 'GET', body, signal, text = false } = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method, signal,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', `Can't reach the API at ${API_URL}`);
  }
  if (!res.ok) {
    let env = null;
    try { env = await res.json(); } catch (_) { /* not JSON */ }
    if (env && typeof env.error === 'string') throw new ApiError(res.status, env.error, env.message || env.error, { code: env.code, details: env.details });
    throw new ApiError(res.status, 'http_' + res.status, `${method} ${path} failed with HTTP ${res.status}`);
  }
  if (text) return res.text();
  if (res.status === 204) return null;
  return res.json();
}

export const contracts = {
  list: (o) => api('/contracts', o),
  register: (id, network, name, o) => api('/contracts', { ...o, method: 'POST', body: name ? { id, network, name } : { id, network } }),
  get: (id, o) => api(`/c/${id}`, o),
  status: (id, o) => api(`/c/${id}/status`, o),
  patch: (id, patch, o) => api(`/c/${id}`, { ...o, method: 'PATCH', body: patch }),
  call: (id, fn, args, source, o) => api(`/c/${id}/call/${fn}`, { ...o, method: 'POST', body: source ? { args, source } : { args } }),
  tx: (id, fn, args, source, opts = {}, o) => api(`/c/${id}/tx/${fn}`, { ...o, method: 'POST', body: { args, source, ...opts } }),
  llms: (id, o) => api(`/c/${id}/llms.txt`, { ...o, text: true }),
  urls: (id) => ({ base: `${API_URL}/c/${id}`, mcp: `${API_URL}/c/${id}/mcp`, llms: `${API_URL}/c/${id}/llms.txt`, openapi: `${API_URL}/c/${id}/openapi.json` })
};

export const shortId = (id) => id.slice(0, 4) + '…' + id.slice(-4);
export const isContractId = (s) => /^C[A-Z2-7]{55}$/.test(s || '');
export const isAccountId = (s) => /^G[A-Z2-7]{55}$/.test(s || '');
export const relTime = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
};
```

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run test/site/api.test.js && npm run build`
Expected: 9 tests PASS; build succeeds (nothing imports the file yet).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.mjs .env.example .gitignore lib/api.js test/site/api.test.js
git commit -m "site: api client with error envelope mapping; vitest setup"
```

---

### Task 2: `lib/useApi.js` — `useApi` and `usePoll`

**Files:**
- Create: `lib/useApi.js`
- Test: `test/site/useApi.test.jsx`

**Interfaces:**
- Produces: `useApi(fetcher: (signal) => Promise<T>, deps: any[]) → { data, error, loading, refetch }`; `usePoll(fetcher, { every = 1500, until: (data) => boolean, enabled = true }) → { data, error, loading }`.

- [ ] **Step 1: Failing tests**

`test/site/useApi.test.jsx`:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApi, usePoll } from '@/lib/useApi';

describe('useApi', () => {
  it('resolves data', async () => {
    const { result } = renderHook(() => useApi(async () => ({ n: 1 }), []));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ n: 1 }); expect(result.current.error).toBeNull();
  });
  it('captures errors and refetches', async () => {
    let calls = 0;
    const { result } = renderHook(() => useApi(async () => { if (++calls === 1) throw new Error('boom'); return 'ok'; }, []));
    await waitFor(() => expect(result.current.error?.message).toBe('boom'));
    await act(async () => { await result.current.refetch(); });
    expect(result.current.data).toBe('ok'); expect(result.current.error).toBeNull();
  });
  it('re-runs when deps change and ignores stale results', async () => {
    const fetcher = vi.fn(async (signal, id) => { await new Promise((r) => setTimeout(r, id === 'a' ? 30 : 5)); return id; });
    const { result, rerender } = renderHook(({ id }) => useApi((signal) => fetcher(signal, id), [id]), { initialProps: { id: 'a' } });
    rerender({ id: 'b' });
    await waitFor(() => expect(result.current.data).toBe('b'));
    await new Promise((r) => setTimeout(r, 40));
    expect(result.current.data).toBe('b');            // 'a' resolved later but was discarded
    expect(fetcher.mock.calls[0][0].aborted).toBe(true); // first request was aborted
  });
});

describe('usePoll', () => {
  it('polls until the predicate is true', async () => {
    let n = 0;
    const { result } = renderHook(() => usePoll(async () => ({ status: ++n >= 3 ? 'ready' : 'running' }), { every: 10, until: (d) => d.status === 'ready' }));
    await waitFor(() => expect(result.current.data?.status).toBe('ready'));
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(3);
  });
  it('does nothing when disabled', async () => {
    const f = vi.fn(async () => ({}));
    renderHook(() => usePoll(f, { every: 5, until: () => false, enabled: false }));
    await new Promise((r) => setTimeout(r, 20));
    expect(f).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run test/site/useApi.test.jsx`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

`lib/useApi.js`:
```js
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `fetcher(signal)` on mount and whenever `deps` change; aborts stale requests; ignores their results. */
export function useApi(fetcher, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ctrl = useRef(null);
  const run = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher(c.signal);
      if (!c.signal.aborted) setState({ data, error: null, loading: false });
    } catch (error) {
      if (!c.signal.aborted && error?.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); return () => ctrl.current?.abort(); }, [run]);
  return { ...state, refetch: run };
}

/** Re-runs `fetcher` every `every` ms until `until(data)` is true (or `enabled` is false). */
export function usePoll(fetcher, { every = 1500, until, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher;
  const untilRef = useRef(until); untilRef.current = until;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false; let timer = null;
    const tick = async () => {
      try {
        const data = await fetcherRef.current();
        if (stopped) return;
        setState({ data, error: null, loading: false });
        if (untilRef.current && untilRef.current(data)) return;
      } catch (error) {
        if (stopped) return;
        setState((s) => ({ ...s, error, loading: false }));
      }
      timer = setTimeout(tick, every);
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [enabled, every]);
  return state;
}
```

- [ ] **Step 3: Run tests + build, commit**

Run: `npm test && npm run build`
Expected: 14 tests PASS; build OK.

```bash
git add lib/useApi.js test/site/useApi.test.jsx
git commit -m "site: useApi and usePoll hooks"
```

---

### Task 3: `lib/args.js`, `<Async>`, `<PreviewBar>`, nav cleanup

**Files:**
- Create: `lib/args.js`, `components/Async.jsx`, `components/PreviewBar.jsx`, `test/site/args.test.js`
- Modify: `components/TopNav.jsx` (remove banner + fake wallet), and add `<PreviewBar />` as the first child of the `<main>` in `components/screens/Explorer.jsx`, `Flows.jsx`, `FlowDetail.jsx`, `Keys.jsx`, `Welcome.jsx` (home) and at the top of `components/workspace/History.jsx`'s fragment.

**Interfaces:**
- Produces: `placeholderFor(schema)`, `fieldKind(schema) → 'boolean' | 'integer' | 'string' | 'json'`, `coerceArgs(inputs, values) → { args, errors: { [name]: message } }` where `inputs` is the model's `functions[i].inputs` zipped with `jsonSchema.properties[name]` and `required`; `<Async loading error onRetry skeleton>`; `<PreviewBar />`.

- [ ] **Step 1: Failing tests**

`test/site/args.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { placeholderFor, fieldKind, coerceArgs } from '@/lib/args';

const dec = { type: 'string', pattern: '^-?[0-9]+$', description: 'i128 as a decimal string' };
const addr = { type: 'string', description: 'Stellar address (G… or C…)' };
const bytes = { type: 'string', pattern: '^0x([0-9a-fA-F]{2})*$', description: 'Bytes as 0x-prefixed hex' };
const map = { type: 'object', additionalProperties: dec };
const opt = { anyOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'null' }] };

describe('fieldKind / placeholderFor', () => {
  it('classifies schemas', () => {
    expect(fieldKind({ type: 'boolean' })).toBe('boolean');
    expect(fieldKind({ type: 'integer' })).toBe('integer');
    expect(fieldKind(dec)).toBe('string');
    expect(fieldKind(map)).toBe('json');
    expect(fieldKind({ type: 'array', items: addr })).toBe('json');
    expect(fieldKind(opt)).toBe('json');
  });
  it('placeholders follow the JSON contract', () => {
    expect(placeholderFor(dec)).toBe('0');
    expect(placeholderFor(addr)).toBe('G…');
    expect(placeholderFor(bytes)).toBe('0x…');
    expect(placeholderFor(map)).toBe('{}');
    expect(placeholderFor({ type: 'array', items: addr })).toBe('[]');
    expect(placeholderFor({ type: 'integer' })).toBe('0');
    expect(placeholderFor({ type: 'string' })).toBe('text');
  });
});

describe('coerceArgs', () => {
  const inputs = [
    { name: 'a', schema: dec, required: true },
    { name: 'n', schema: { type: 'integer' }, required: true },
    { name: 'ok', schema: { type: 'boolean' }, required: true },
    { name: 'm', schema: map, required: true },
    { name: 'v', schema: opt, required: false }
  ];
  it('coerces per kind and omits empty optionals', () => {
    const { args, errors } = coerceArgs(inputs, { a: '12', n: '7', ok: true, m: '{"x":"1"}', v: '' });
    expect(errors).toEqual({});
    expect(args).toEqual({ a: '12', n: 7, ok: true, m: { x: '1' } });
  });
  it('reports missing required and bad JSON/number by field', () => {
    const { errors } = coerceArgs(inputs, { a: '', n: 'x', ok: false, m: '{bad', v: '' });
    expect(errors.a).toMatch(/required/i);
    expect(errors.n).toMatch(/integer/i);
    expect(errors.m).toMatch(/JSON/);
  });
  it('json optional with a value is parsed', () => {
    const { args } = coerceArgs(inputs, { a: '1', n: '1', ok: false, m: '{}', v: '"5"' });
    expect(args.v).toBe('5');
  });
});
```

Run: `npx vitest run test/site/args.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `lib/args.js`**

```js
/** Form helpers for contract arguments, driven by the API's per-function JSON Schema (self-contained, JSON-contract conventions). */
export function fieldKind(schema = {}) {
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer') return 'integer';
  if (schema.type === 'string') return 'string';
  return 'json'; // object, array, anyOf/oneOf (Option, unions), tuples
}

export function placeholderFor(schema = {}) {
  const d = schema.description || '';
  if (schema.type === 'integer') return '0';
  if (schema.type === 'string') {
    if (/decimal string/i.test(d) || /^\^-\?\[0-9\]\+\$$/.test(schema.pattern || '') || /^\^\[0-9\]\+\$$/.test(schema.pattern || '')) return '0';
    if (/address/i.test(d)) return 'G…';
    if (/hex/i.test(d) || /0x/.test(schema.pattern || '')) return '0x…';
    return 'text';
  }
  if (schema.type === 'object') return '{}';
  if (schema.type === 'array') return '[]';
  if (Array.isArray(schema.anyOf)) return placeholderFor(schema.anyOf.find((s) => s.type !== 'null') || {});
  if (Array.isArray(schema.oneOf)) return JSON.stringify(schema.oneOf[0]?.const ?? '"…"');
  if (Array.isArray(schema.enum)) return String(schema.enum[0]);
  return '';
}

/** values: { [name]: string | boolean } from the form. Returns args ready for the API plus per-field errors. */
export function coerceArgs(inputs, values) {
  const args = {}; const errors = {};
  for (const { name, schema, required } of inputs) {
    const kind = fieldKind(schema);
    const raw = values[name];
    const empty = raw === undefined || raw === null || raw === '';
    if (kind === 'boolean') { args[name] = Boolean(raw); continue; }
    if (empty) { if (required) errors[name] = 'Required'; continue; }
    if (kind === 'integer') {
      const n = Number(raw);
      if (!Number.isInteger(n)) errors[name] = 'Must be an integer'; else args[name] = n;
    } else if (kind === 'string') {
      args[name] = String(raw);
    } else {
      try { args[name] = JSON.parse(raw); } catch (_) { errors[name] = 'Must be valid JSON'; }
    }
  }
  return { args, errors };
}

/** Zip a function's inputs with its JSON Schema so forms have name/type/schema/required in one place. */
export function inputsOf(fn) {
  const props = fn.jsonSchema?.properties || {};
  const req = new Set(fn.jsonSchema?.required || []);
  return fn.inputs.map((i) => ({ name: i.name, type: i.type, schema: props[i.name] || {}, required: req.has(i.name) }));
}
```

- [ ] **Step 3: `Async` and `PreviewBar`**

`components/Async.jsx`:
```jsx
'use client';
import { API_URL } from '@/lib/api';

/** Standard loading/error wrapper for live screens. `skeleton` renders while loading; errors render inline with the machine code and a Retry. */
export default function Async({ S, loading, error, onRetry, skeleton = null, children }) {
  if (loading) return skeleton ?? <Skeleton />;
  if (error) {
    const network = error.status === 0;
    return (
      <div className="async-error" role="alert" style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="sn-body" style={{ fontWeight: 700 }}>{network ? `Can't reach the API at ${API_URL}` : error.message || 'Something went wrong'}</div>
        {error.error && <div className="sn-mono sn-muted">{error.error}{error.code !== undefined ? ` · code ${error.code}` : ''}</div>}
        {onRetry && S && <div><S.Button variant="secondary" onClick={onRetry}>Retry</S.Button></div>}
      </div>
    );
  }
  return children;
}

export function Skeleton({ rows = 3 }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} style={{ height: 18, width: `${70 - i * 12}%`, background: 'var(--sn-hairline)', borderRadius: 2 }} />)}
    </div>
  );
}
```

`components/PreviewBar.jsx`:
```jsx
export default function PreviewBar() {
  return (
    <div className="preview-bar" role="note">
      <span className="preview-bar__dot" aria-hidden="true" />
      <span>Preview build · sample data<span className="preview-bar__long"> · nothing is sent to the network</span></span>
    </div>
  );
}
```

`components/TopNav.jsx`: delete the `<div className="preview-bar">…</div>` block and the `{!home && <span className="sn-mono nav-wallet">GBX7…4Q9</span>}` line; keep the `Testnet` chip only when `home` is true. Then add `<PreviewBar />` (imported from `@/components/PreviewBar`) as the first element inside the top-level `<main …>` of `Explorer.jsx`, `Flows.jsx`, `FlowDetail.jsx`, `Keys.jsx`, `Welcome.jsx`, and as the first element of the fragment returned by `workspace/History.jsx`. If `.preview-bar` in `app/globals.css` is styled as a full-width bar under the header (check `position`/margins), adjust it so it also reads well inside `.page` (e.g. `margin: -8px 0 8px` or none) — keep it one CSS rule.

- [ ] **Step 4: Run tests + build, commit**

Run: `npm test && npm run build`
Expected: 19 tests PASS; build OK; `npm run dev` → `/explorer` shows the banner inside the page and the nav no longer shows a wallet.

```bash
git add lib/args.js components/Async.jsx components/PreviewBar.jsx components/TopNav.jsx components/screens components/workspace/History.jsx app/globals.css test/site/args.test.js
git commit -m "site: arg form helpers, Async wrapper, per-screen preview bar"
```

---

### Task 4: Workspace route `/c/[id]/[tab]` and live shell

**Files:**
- Create: `app/c/[id]/[tab]/page.jsx`, `app/c/[id]/page.jsx`
- Delete: `app/c/[tab]/page.jsx`
- Modify: `components/workspace/Workspace.jsx`, `components/data.js` (drop `WS_TABS`, keep `TAB_LABEL`)

**Interfaces:**
- Produces: `<Workspace id tab />` renders header + tabs and passes `{ S, contract, id, refetch }` to the tab body. Tab bodies (Tasks 6–9) receive exactly those props. Until they are rewritten, they still render demo data — the shell must not depend on their internals.

- [ ] **Step 1: Routes**

`app/c/[id]/[tab]/page.jsx`:
```jsx
import Workspace from '@/components/workspace/Workspace';
import { TAB_LABEL } from '@/components/data';
import { pageMeta } from '@/components/seo';

export async function generateMetadata({ params }) {
  const { id, tab } = await params;
  const label = TAB_LABEL[tab] || 'Overview';
  return pageMeta({ title: `${label} · ${id.slice(0, 4)}…${id.slice(-4)}`, description: `Contract workspace: ${label.toLowerCase()} for the generated REST API, MCP server and docs.`, path: `/c/${id}/${TAB_LABEL[tab] ? tab : 'overview'}` });
}

export default async function Page({ params }) {
  const { id, tab } = await params;
  return <Workspace id={id} tab={tab} />;
}
```

`app/c/[id]/page.jsx`:
```jsx
import { redirect } from 'next/navigation';
export default async function Page({ params }) {
  const { id } = await params;
  redirect(`/c/${id}/overview`);
}
```

Delete `app/c/[tab]/page.jsx` (and the now-empty directory).

- [ ] **Step 2: Workspace shell**

`components/workspace/Workspace.jsx`:
```jsx
'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime } from '@/lib/api';
import { useApi, usePoll } from '@/lib/useApi';
import Async from '@/components/Async';
import { CopyButton } from '@/components/ui';
import { TAB_LABEL } from '@/components/data';
import Overview from './Overview';
import Functions from './Functions';
import Mcp from './Mcp';
import Docs from './Docs';
import History from './History';

const STATUS = { ready: ['good', 'Indexed'], queued: ['warning', 'Indexing'], running: ['warning', 'Indexing'], failed: ['bad', 'Failed'] };
const STEP = { queued: ['neutral', 'Queued'], running: ['warning', 'Running'], done: ['good', 'Done'], skipped: ['neutral', 'Skipped'], failed: ['bad', 'Failed'] };

export function StepChip({ S, status }) { const [tone, label] = STEP[status] || STEP.queued; return <S.Chip tone={tone}>{label}</S.Chip>; }

export function PipelineSteps({ S, steps }) {
  return (
    <div style={{ borderTop: '1px solid var(--sn-ink)' }}>
      {steps.map((s, i) => (
        <div key={s.name} className="pipe-row">
          <span className="pipe-row__num"><S.Numeral index={i + 1} /></span>
          <div className="sn-body pipe-row__name" style={{ fontWeight: 700 }}>{({ fetch: 'Fetch WASM from network', parse: 'Parse SEP-48 contract spec', generate: 'Generate REST API + MCP + docs', index: 'Index on-chain history' })[s.name] || s.name}</div>
          <div className="sn-mono pipe-row__desc" style={s.status === 'failed' ? { color: 'var(--sn-bad, #b00)' } : undefined}>{s.status === 'failed' ? s.error : s.detail}</div>
          <span className="pipe-row__chip"><StepChip S={S} status={s.status} /></span>
        </div>
      ))}
    </div>
  );
}

function NotReady({ S, id, initial, onReady }) {
  const { data } = usePoll(() => contracts.status(id), { every: 1500, until: (d) => d.status === 'ready' || d.status === 'failed' });
  const st = data || initial;
  useEffect(() => { if (data?.status === 'ready') onReady(); }, [data, onReady]);
  return (
    <div>
      <div className="sn-label">{st.status === 'failed' ? 'Registration failed' : 'Registering…'}</div>
      <div style={{ marginTop: 16 }}><PipelineSteps S={S} steps={st.steps || []} /></div>
      {st.status === 'failed' && <div style={{ marginTop: 20 }}><Link className="crumb" href={`/register?id=${id}`}>Try again</Link></div>}
    </div>
  );
}

export default function Workspace({ id, tab }) {
  const S = useSonataUI();
  const router = useRouter();
  const t = TAB_LABEL[tab] ? tab : 'overview';
  const { data: contract, error, loading, refetch } = useApi(() => contracts.get(id), [id]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [renameErr, setRenameErr] = useState(null);
  const tabsRef = useRef(null);
  useEffect(() => {
    const strip = tabsRef.current && tabsRef.current.querySelector('.sn-tabs');
    const active = strip && strip.querySelector('[aria-selected="true"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = Math.max(0, active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
  }, [S, t, contract]);
  if (!S) return null;

  const title = contract?.name || shortId(id);
  const fns = contract?.functions?.length || 0;
  const rw = contract?.mcp_scope === 'rw';
  const tabs = [
    { id: 'overview', label: 'Overview' }, { id: 'functions', label: 'Functions', count: fns },
    { id: 'mcp', label: 'MCP', count: rw ? fns * 2 + 3 : fns + 2 }, { id: 'docs', label: 'Docs' }, { id: 'history', label: 'History' }
  ];
  const Body = t === 'functions' ? Functions : t === 'mcp' ? Mcp : t === 'docs' ? Docs : t === 'history' ? History : Overview;
  const [tone, label] = STATUS[contract?.status] || STATUS.queued;

  const saveName = async () => {
    setRenameErr(null);
    try { await contracts.patch(id, { name: name.trim() || null }); setRenaming(false); refetch(); }
    catch (e) { setRenameErr(e); }
  };

  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/contracts">Contracts</Link> / {title}{t !== 'overview' ? ' / ' + TAB_LABEL[t] : ''}</div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {contract && contract.status !== 'ready' ? (
          <NotReady S={S} id={id} initial={contract} onReady={refetch} />
        ) : contract && (
          <>
            <div className="page-head" style={{ gap: 24 }}>
              <div style={{ minWidth: 0, maxWidth: '100%' }}>
                {renaming ? (
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <S.Field label="Name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!renameErr} hint={renameErr ? renameErr.message : 'Shown in lists and docs'} />
                    <S.Button onClick={saveName}>Save</S.Button>
                    <S.Button variant="text" onClick={() => setRenaming(false)}>Cancel</S.Button>
                  </div>
                ) : (
                  <h1 className="sn-h1" style={{ margin: 0, display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    {title}
                    <S.Button variant="text" size="sm" onClick={() => { setName(contract.name || ''); setRenaming(true); }}>Rename</S.Button>
                  </h1>
                )}
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{id}</span>
                  <CopyButton S={S} text={id}>Copy</CopyButton>
                  <S.Chip tone={contract.network === 'mainnet' ? 'inverse' : 'neutral'}>{contract.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
                  <S.Chip tone={tone}>{label} {relTime(contract.updated_at)}</S.Chip>
                </div>
              </div>
              <div className="actions">
                <CopyButton S={S} variant="primary" arrow text={contract.urls.mcp}>Copy MCP URL</CopyButton>
              </div>
            </div>
            <div ref={tabsRef} style={{ minWidth: 0 }}>
              <S.Tabs items={tabs} active={t} onChange={(next) => router.push(`/c/${id}/${next}`)} />
            </div>
            <Body S={S} contract={contract} id={id} refetch={refetch} />
          </>
        )}
      </Async>
    </main>
  );
}
```

`components/data.js`: remove `WS_TABS` (keep `TAB_LABEL`). Grep for other importers of `WS_TABS` (none expected).

- [ ] **Step 3: Build + manual check, commit**

Run: `npm run build` then `npm run dev` with the API running locally (`cd server && npm run dev`) and open `http://localhost:3000/c/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP/overview` after registering that id via curl if it isn't registered yet (`curl -X POST localhost:8080/contracts -H 'content-type: application/json' -d '{"id":"CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP","network":"testnet","name":"KitchenSink"}'`).
Expected: header shows `KitchenSink`, the id, `Testnet`, `Indexed …`; tabs show `Functions 16`, `MCP 18`; `/c/CNOPE/overview` shows the error panel with `contract_not_found`; `/c/<id>` redirects to `/overview`; Rename → Save updates the title. Tab bodies still show demo content (rewritten next).

```bash
git add app/c components/workspace/Workspace.jsx components/data.js
git commit -m "site: workspace route per contract; live shell with status, rename and tabs"
```

---

### Task 5: Register goes live

**Files:**
- Modify: `components/screens/Register.jsx` (rewrite), `app/register/page.jsx` (pass `searchParams.id`)
- Modify: `components/data.js` (drop `PIPE`)

**Interfaces:**
- Consumes: `contracts.register`, `contracts.status`, `usePoll`, `PipelineSteps` (from `Workspace.jsx`), `isContractId`.

- [ ] **Step 1: Page passes the prefill**

`app/register/page.jsx`:
```jsx
import Register from '@/components/screens/Register';
import { pageMeta } from '@/components/seo';
export const metadata = pageMeta({ title: 'Register contract', description: 'Paste a Soroban contract ID to generate its REST API, MCP tools and AI-ready docs.', path: '/register' });
export default async function Page({ searchParams }) {
  const { id } = await searchParams;
  return <Register initialId={typeof id === 'string' ? id : ''} />;
}
```

- [ ] **Step 2: Screen**

`components/screens/Register.jsx`:
```jsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, isContractId } from '@/lib/api';
import { usePoll } from '@/lib/useApi';
import { Label } from '@/components/ui';
import { PipelineSteps } from '@/components/workspace/Workspace';
import { NET_OPTS } from '@/components/data';

const DONE = (d) => d.status === 'ready' || d.status === 'failed';

export default function Register({ initialId = '' }) {
  const S = useSonataUI();
  const router = useRouter();
  const [addr, setAddr] = useState(initialId);
  const [name, setName] = useState('');
  const [net, setNet] = useState('testnet');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);
  const [job, setJob] = useState(null);                 // { id, steps } from the 202
  const poll = usePoll(() => contracts.status(job.id), { every: 1500, until: DONE, enabled: !!job });
  const st = poll.data || job;
  if (!S) return null;
  const valid = isContractId(addr.trim());

  const generate = async () => {
    setSubmitErr(null); setSubmitting(true); setJob(null);
    try { const r = await contracts.register(addr.trim(), net, name.trim() || undefined); setJob({ id: r.id, status: r.status, steps: r.steps }); }
    catch (e) { setSubmitErr(e); }
    finally { setSubmitting(false); }
  };

  const fieldHint = submitErr ? submitErr.message : '56 characters, starts with C';
  return (
    <main className="page" style={{ maxWidth: 976, gap: 0 }}>
      <h1 className="sn-h1" style={{ margin: 0 }}>Register contract</h1>
      <div className="sn-body sn-muted" style={{ marginTop: 14 }}>Paste a Soroban contract address to generate its API, MCP tools and docs.</div>
      <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <S.Field label="Contract address" mono action="Paste" hint={fieldHint} invalid={!!submitErr || (addr.length > 0 && !valid)}
          value={addr} onChange={(e) => { setAddr(e.target.value); setSubmitErr(null); }}
          onAction={() => { if (navigator.clipboard?.readText) navigator.clipboard.readText().then((t) => { if (t) setAddr(t.trim()); }).catch(() => {}); }} />
        <S.Field label="Name (optional)" hint="Shown in lists and generated docs" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="seg-wrap" style={{ alignSelf: 'flex-start' }}>
          <S.Segmented ariaLabel="Network" options={NET_OPTS} value={net} onChange={setNet} />
        </div>
        <div className="actions">
          <S.Button arrow disabled={!valid || submitting} onClick={generate}>{submitting ? 'Submitting…' : 'Generate'}</S.Button>
          <S.Button variant="secondary" onClick={() => router.push('/contracts')}>Cancel</S.Button>
        </div>
        {submitErr && submitErr.error === 'network_not_configured' && (
          <div className="sn-small sn-muted">Mainnet isn't enabled on this server yet — register on Testnet, or contact the operator.</div>
        )}
      </div>
      {st && (
        <div>
          <Label style={{ marginTop: 56 }}>Pipeline</Label>
          <div style={{ marginTop: 16 }}><PipelineSteps S={S} steps={st.steps || []} /></div>
          {poll.error && <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Status check failed ({poll.error.error}); retrying…</div>}
          {st.status === 'ready' && (
            <div style={{ marginTop: 32 }}><S.Button arrow onClick={() => router.push(`/c/${job.id}/overview`)}>Open contract workspace</S.Button></div>
          )}
          {st.status === 'failed' && (
            <div style={{ marginTop: 32, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sn-small">{st.error || 'Registration failed.'}</span>
              <S.Button variant="secondary" onClick={generate}>Try again</S.Button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
```
Remove `PIPE` from `components/data.js` (grep to confirm no other importer; `Welcome.jsx` may render the pipeline preview from `PIPE` — if it does, keep `PIPE` and only drop the `Register` import).

- [ ] **Step 3: Build + manual check, commit**

Run: `npm run build`; then with API + site running: `/register` → paste `CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP` → Generate → four steps animate through `Done/Done/Done/Skipped` → "Open contract workspace". Paste `CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4` → Generate → step 1 fails with the API's "does not exist on testnet" text → Try again re-POSTs. `nope` keeps Generate disabled. Mainnet → `network_not_configured` message under the field.

```bash
git add app/register/page.jsx components/screens/Register.jsx components/data.js
git commit -m "site: register posts to the api and polls the real pipeline"
```

---

### Task 6: Contracts list, Overview tab, Docs tab (read-only screens)

**Files:**
- Modify: `components/screens/Contracts.jsx`, `components/workspace/Overview.jsx`, `components/workspace/Docs.jsx` (rewrites)
- Modify: `components/data.js` (drop `CONTRACTS`, `SURFACES`, `BAR_VALS`, `LLMS`, `MCP_URL`, `MCP_CONFIG`, `CONTRACT_ID`, `XDR` only if no demo screen still imports them — grep first; `DocsPage` uses `LLMS`/`MCP_CONFIG`, so those stay)

**Interfaces:**
- Consumes: `contracts.list/get/llms/urls`, `useApi`, `<Async>`, `relTime`, `shortId`, `download`, `CopyButton`, `Label`, `ResponsiveTable`.

- [ ] **Step 1: Contracts**

`components/screens/Contracts.jsx`:
```jsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';

const STATUS = { ready: ['good', 'Indexed'], queued: ['warning', 'Indexing'], running: ['warning', 'Indexing'], failed: ['bad', 'Failed'] };

export default function Contracts() {
  const S = useSonataUI();
  const router = useRouter();
  const { data, error, loading, refetch } = useApi(() => contracts.list(), []);
  if (!S) return null;
  const list = data || [];
  return (
    <main className="page" style={{ gap: 32 }}>
      <div className="page-head">
        <div className="page-head__title">
          <h1 className="sn-h1" style={{ margin: 0 }}>My contracts</h1>
          <span className="sn-label sn-muted">{data ? `${list.length} registered` : ''}</span>
        </div>
        <div className="actions"><S.Button arrow onClick={() => router.push('/register')}>Add a contract</S.Button></div>
      </div>
      <Async S={S} loading={loading} error={error} onRetry={refetch}>
        {list.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '32px 0' }}>
            <div className="sn-body" style={{ fontWeight: 700 }}>No contracts yet</div>
            <div className="sn-small sn-muted" style={{ marginTop: 8 }}>Register a Soroban contract to get its API, MCP tools and docs.</div>
          </div>
        ) : (
          <div className="card-grid">
            {list.map((c, i) => {
              const [tone, label] = STATUS[c.status] || STATUS.queued;
              const href = c.status === 'failed' ? `/register?id=${c.id}` : `/c/${c.id}/overview`;
              return (
                <Link key={c.id} className="card" href={href}>
                  <div className="card__top">
                    <S.Numeral index={i + 1} />
                    <div className="card__chips">
                      <S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
                      <S.Chip tone={tone}>{label}</S.Chip>
                    </div>
                  </div>
                  <div className="sn-h3 card__title">{c.name || shortId(c.id)}</div>
                  <div className="sn-mono sn-muted card__id">{c.id}</div>
                  <div className="card__desc" />
                  <div className="card__inputs">
                    <div className="sn-label sn-muted">Surface</div>
                    <div className="sn-mono card__names">{c.fns} functions · updated {relTime(c.updated_at)}</div>
                  </div>
                  <div className="card__foot"><span className="sn-label">{c.status === 'failed' ? 'Retry registration' : 'Open workspace'}</span><span className="sn-mono">→</span></div>
                </Link>
              );
            })}
          </div>
        )}
      </Async>
    </main>
  );
}
```

- [ ] **Step 2: Overview**

`components/workspace/Overview.jsx`:
```jsx
'use client';
import Link from 'next/link';
import { Label } from '@/components/ui';
import { relTime } from '@/lib/api';

export default function Overview({ S, contract: c, id }) {
  const fns = c.functions.length;
  const rw = c.mcp_scope === 'rw';
  const surfaces = [
    { name: 'REST API', d: `${fns} functions · /call · /tx`, href: `/c/${id}/functions` },
    { name: 'MCP server', d: `${rw ? fns * 2 + 3 : fns + 2} tools · ${rw ? 'read + write' : 'read-only by default'}`, href: `/c/${id}/mcp` },
    { name: 'Docs', d: 'llms.txt · OpenAPI 3.1', href: `/c/${id}/docs` },
    { name: 'History', d: 'preview · indexing arrives in a later release', href: `/c/${id}/history`, preview: true }
  ];
  return (
    <>
      <div className="sn-stat-row">
        <S.Stat label="Functions" value={String(fns)} />
        <S.Stat label="Types" value={String(c.types.length)} />
        <S.Stat label="Errors" value={String(c.errors.length)} />
        <S.Stat label="Events" value={String(c.events.length)} />
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <Label>Generated surfaces</Label>
          <div style={{ marginTop: 16, borderTop: '1px solid var(--sn-ink)' }}>
            {surfaces.map((s, i) => (
              <Link key={s.name} className="row-link" href={s.href}
                style={{ display: 'grid', gridTemplateColumns: '48px minmax(0, 1fr) 24px', gap: '0 16px', alignItems: 'center', padding: '15px 0', borderBottom: '1px solid var(--sn-hairline)' }}>
                <S.Numeral index={i + 1} />
                <div>
                  <div className="sn-body" style={{ fontWeight: 700 }}>{s.name}{s.preview && <> <S.Chip tone="neutral">preview</S.Chip></>}</div>
                  <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 3 }}>{s.d}</div>
                </div>
                <div className="sn-mono" style={{ fontSize: 16 }}>→</div>
              </Link>
            ))}
          </div>
        </div>
        <div>
          <Label>Contract</Label>
          <div style={{ marginTop: 16 }}>
            <S.KeyValueList rows={[
              { key: 'Network', value: c.network, mono: false },
              { key: 'Contract ID', value: c.id },
              { key: 'WASM hash', value: c.wasmHash.slice(0, 12) + '…' },
              { key: 'Registered', value: relTime(c.created_at), mono: false },
              { key: 'Status', value: c.status, mono: false },
              { key: 'MCP scope', value: rw ? 'read + write' : 'read-only', mono: false },
              { key: 'OpenAPI', value: <a className="crumb" href={c.urls.openapi} target="_blank" rel="noreferrer">openapi.json</a> }
            ]} />
          </div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Docs**

`components/workspace/Docs.jsx`:
```jsx
'use client';
import { download } from '@/lib/sonata';
import { contracts, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';
import { Label, CopyButton } from '@/components/ui';

export default function Docs({ S, contract: c, id }) {
  const { data: text, error, loading, refetch } = useApi(() => contracts.llms(id), [id, c.updated_at]);
  const file = (c.name || id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  return (
    <div className="two-col">
      <div>
        <Label style={{ marginBottom: 16 }}>llms.txt</Label>
        <Async S={S} loading={loading} error={error} onRetry={refetch}>
          <div className="code-panel"><pre className="sn-mono" style={{ fontSize: 12.5, lineHeight: 1.8, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre></div>
        </Async>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>About these docs</Label>
        <S.KeyValueList rows={[
          { key: 'Format', value: 'Markdown · llms.txt', mono: false },
          { key: 'Generated', value: relTime(c.updated_at), mono: false },
          { key: 'Source', value: 'SEP-48 spec', mono: false },
          { key: 'URL', value: c.urls.llms }
        ]} />
        <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <CopyButton S={S} variant="primary" text={c.urls.llms}>Copy link</CopyButton>
          <S.Button variant="secondary" disabled={!text} onClick={() => download(file, text || '', 'text/markdown')}>Download .md</S.Button>
          <a className="crumb sn-label" href={c.urls.openapi} target="_blank" rel="noreferrer">OpenAPI JSON</a>
        </div>
        <div className="sn-small sn-muted" style={{ marginTop: 16 }}>Docs regenerate automatically when the contract's WASM changes or the contract is renamed.</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Prune, build, manual check, commit**

Grep `components/` for each constant before removing it from `data.js`; remove only what no demo screen imports. Run `npm run build`. Manual: `/contracts` lists KitchenSink with `16 functions`; Overview shows 16 / 4 / 2 / 1 stats and a working OpenAPI link; Docs shows the real llms.txt and downloads `kitchensink.md`.

```bash
git add components/screens/Contracts.jsx components/workspace/Overview.jsx components/workspace/Docs.jsx components/data.js
git commit -m "site: contracts list, overview and docs tabs read the api"
```

---

### Task 7: Functions tab — simulate and build XDR

**Files:**
- Modify: `components/workspace/Functions.jsx` (rewrite)
- Modify: `components/data.js` (drop `FN`, `SIM_OPTS`, `XDR` if unreferenced — `FN_COLS` stays, `ContractPublic` uses it until Task 9)

**Interfaces:**
- Consumes: `contracts.call/tx`, `inputsOf`, `fieldKind`, `placeholderFor`, `coerceArgs`, `isAccountId`, `download`, `CodeBox`, `CopyButton`, `ResponsiveTable`, `Label`.

- [ ] **Step 1: Screen**

`components/workspace/Functions.jsx`:
```jsx
'use client';
import { useMemo, useState } from 'react';
import { download } from '@/lib/sonata';
import { contracts, isAccountId } from '@/lib/api';
import { inputsOf, fieldKind, placeholderFor, coerceArgs } from '@/lib/args';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';

const COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'fn', header: 'Function', width: '170px', strong: true },
  { key: 'sig', header: 'Signature', mono: true },
  { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];
const MODES = [{ value: 'sim', label: 'Simulate' }, { value: 'build', label: 'Build transaction' }];
const sig = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;
const kindChip = (S, k) => k === 'write' ? <S.Chip tone="inverse">Write</S.Chip> : k === 'read' ? <S.Chip tone="neutral">Read</S.Chip> : <S.Chip tone="neutral">—</S.Chip>;

export default function Functions({ S, contract: c, id }) {
  const [sel, setSel] = useState(c.functions[0]?.name || null);
  const fn = c.functions.find((f) => f.name === sel) || null;
  const inputs = useMemo(() => (fn ? inputsOf(fn) : []), [fn]);
  const [values, setValues] = useState({});
  const [source, setSource] = useState('');
  const [mode, setMode] = useState('sim');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [out, setOut] = useState(null);         // { kind: 'sim'|'build'|'error', body }
  const pick = (name) => { setSel(name); setValues({}); setErrors({}); setOut(null); };

  const run = async () => {
    const { args, errors: e } = coerceArgs(inputs, values);
    if (mode === 'build' && !isAccountId(source.trim())) e.source = 'A G… account address is required to build a transaction';
    if (mode === 'sim' && source.trim() && !isAccountId(source.trim())) e.source = 'Must be a G… account address';
    setErrors(e); setOut(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = mode === 'sim' ? await contracts.call(id, fn.name, args, source.trim() || undefined) : await contracts.tx(id, fn.name, args, source.trim());
      setOut({ kind: mode, body });
    } catch (err) {
      if (err.error === 'invalid_args' && err.details?.path) setErrors({ [err.details.path]: err.message });
      setOut({ kind: 'error', body: err });
    } finally { setBusy(false); }
  };

  const rows = c.functions.map((f, i) => ({
    num: <S.Numeral index={i + 1} />,
    fn: <button type="button" className="crumb" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: f.name === sel ? 700 : 400, cursor: 'pointer' }} onClick={() => pick(f.name)}>{f.name}</button>,
    sig: sig(f), kind: kindChip(S, f.kind)
  }));

  return (
    <>
      <ResponsiveTable S={S} columns={COLS} rows={rows} minWidth={760} />
      {fn && (
        <div className="two-col" style={{ marginTop: 24 }}>
          <div>
            <div className="sn-label sn-muted">Function detail · {fn.kind === 'unknown' ? 'unclassified' : fn.kind}</div>
            <h2 className="sn-h2" style={{ margin: '14px 0 0' }}>{fn.name}</h2>
            {fn.doc && <p className="sn-body sn-muted" style={{ marginTop: 8 }}>{fn.doc}</p>}
            <div className="sn-mono" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>POST {c.urls.base}/{mode === 'sim' ? 'call' : 'tx'}/{fn.name}</div>
            <Label style={{ marginTop: 32 }}>Parameters</Label>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {inputs.length === 0 && <div className="sn-small sn-muted">No parameters.</div>}
              {inputs.map((i) => {
                const kind = fieldKind(i.schema);
                if (kind === 'boolean') return (
                  <label key={i.name} className="sn-small" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input type="checkbox" checked={!!values[i.name]} onChange={(e) => setValues({ ...values, [i.name]: e.target.checked })} /> {i.name} <span className="sn-muted">bool</span>
                  </label>
                );
                if (kind === 'json') return (
                  <div key={i.name}>
                    <div className="sn-small" style={{ fontWeight: 700 }}>{i.name} <span className="sn-muted" style={{ fontWeight: 400 }}>{i.type} · JSON</span></div>
                    <textarea className="sn-mono" rows={3} style={{ width: '100%', marginTop: 6, font: 'inherit', fontFamily: 'var(--sn-font-mono)', border: '1px solid var(--sn-ink)', padding: 8, borderColor: errors[i.name] ? 'var(--sn-bad, #b00)' : undefined }}
                      placeholder={placeholderFor(i.schema)} value={values[i.name] || ''} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
                    {errors[i.name] && <div className="sn-small" style={{ color: 'var(--sn-bad, #b00)', marginTop: 4 }}>{errors[i.name]}</div>}
                  </div>
                );
                return (
                  <S.Field key={i.name} label={i.name} mono hint={errors[i.name] || i.type + (i.required ? '' : ' · optional')} invalid={!!errors[i.name]}
                    type={kind === 'integer' ? 'number' : 'text'} placeholder={placeholderFor(i.schema)}
                    value={values[i.name] || ''} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
                );
              })}
              <S.Field label="source" mono hint={errors.source || (mode === 'build' ? 'G… account that will sign (required)' : 'G… account for the simulation (optional)')} invalid={!!errors.source}
                placeholder="G…" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <S.Segmented ariaLabel="Mode" options={MODES} value={mode} onChange={(v) => { setMode(v); setOut(null); setErrors({}); }} />
              <S.Button disabled={busy} onClick={run}>{busy ? 'Working…' : mode === 'sim' ? 'Simulate' : 'Build unsigned XDR'}</S.Button>
            </div>
          </div>
          <div>
            {out?.kind === 'sim' && (
              <>
                <Label>Result</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox right={<CopyButton S={S} text={JSON.stringify(out.body.result, null, 2)}>Copy</CopyButton>}>
                    <div>
                      <pre className="sn-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(out.body.result, null, 2)}</pre>
                      <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 10 }}>Simulated · {out.body.latency_ms} ms · ledger {out.body.ledger}</div>
                      {out.body.auth?.length > 0 && <div className="sn-mono" style={{ marginTop: 6 }}>Must sign: {out.body.auth.join(', ')}</div>}
                    </div>
                  </CodeBox>
                </div>
              </>
            )}
            {out?.kind === 'build' && (
              <>
                <Label>Unsigned XDR</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox right={<CopyButton S={S} text={out.body.xdr}>Copy</CopyButton>}>
                    <div className="sn-mono" style={{ fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' }}>{out.body.xdr}</div>
                  </CodeBox>
                </div>
                <div style={{ marginTop: 16 }}>
                  <S.KeyValueList rows={[
                    { key: 'Fee', value: `${out.body.fee} stroops` },
                    { key: 'Signers', value: out.body.auth.join(', ') || '—' },
                    { key: 'Expires', value: new Date(out.body.expires_at).toLocaleTimeString(), mono: false }
                  ]} />
                </div>
                <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <S.Button variant="secondary" onClick={() => download(`${fn.name}-unsigned.xdr`, out.body.xdr)}>Download XDR</S.Button>
                </div>
                <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Sign it with Freighter or any Stellar signer and submit with <span className="sn-mono">POST {c.urls.base}/submit</span>. In-app signing is coming.</div>
              </>
            )}
            {out?.kind === 'error' && (
              <>
                <Label>Error</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox>
                    <div>
                      <div className="sn-body" style={{ fontWeight: 700 }}>{out.body.message}</div>
                      <div className="sn-mono sn-muted" style={{ marginTop: 6 }}>{out.body.error}{out.body.code !== undefined ? ` · code ${out.body.code}` : ''}{out.body.status ? ` · HTTP ${out.body.status}` : ''}</div>
                    </div>
                  </CodeBox>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Build + manual check, commit**

Run: `npm run build`. Manual on KitchenSink: `add` a=5, b=7 → Simulate → `"12"`; `checked` n=101 → Error box `The number was too big. · TooBig · code 1 · HTTP 422`; `echo_map` m=`{"x":"1"}` → `{"x":"1"}`; `ping` who=`GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`, n=1 → Simulate shows `Must sign: GAAA…WHF`; Build with a real funded testnet `G…` as source → XDR box + fee; Build with empty source → inline `source` error, no request sent. `echo_bytes` with `zz` → 400 marks the `b` field.

```bash
git add components/workspace/Functions.jsx components/data.js
git commit -m "site: functions tab simulates and builds unsigned xdr against the api"
```

---

### Task 8: MCP tab — scope toggle, tool list, config

**Files:**
- Modify: `components/workspace/Mcp.jsx` (rewrite)
- Modify: `components/data.js` (drop `TL`, `TOOL_COLS`, `MCP_OPTS` if unreferenced)

**Interfaces:**
- Consumes: `contracts.patch`, `refetch` from the shell, `CodeBox`, `CopyButton`, `ResponsiveTable`, `Label`.

- [ ] **Step 1: Screen**

`components/workspace/Mcp.jsx`:
```jsx
'use client';
import { useState } from 'react';
import { contracts, shortId } from '@/lib/api';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';

const COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'tool', header: 'Tool', width: '260px', strong: true },
  { key: 'src', header: 'Source', mono: true },
  { key: 'kind', header: 'Kind', width: '110px' },
  { key: 'on', header: 'Enabled', width: '110px', align: 'right' }
];
const SCOPES = [{ value: 'ro', label: 'Read only' }, { value: 'rw', label: 'Read + write' }];
export const slugOf = (c) => (c.name || shortId(c.id)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const mcpConfig = (c) => JSON.stringify({ mcpServers: { ['sonata-' + slugOf(c)]: { url: c.urls.mcp, type: 'http' } } }, null, 2);

export default function Mcp({ S, contract: c, id, refetch }) {
  const [scope, setScope] = useState(c.mcp_scope);
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const rw = scope === 'rw';
  const change = async (v) => {
    const prev = scope; setScope(v); setErr(null); setSaving(true);
    try { await contracts.patch(id, { mcp_scope: v }); refetch(); }
    catch (e) { setScope(prev); setErr(e); }
    finally { setSaving(false); }
  };
  const tools = [
    ...c.functions.map((f) => ({ tool: `call_${f.name}`, src: 'contract', write: false, on: true })),
    ...c.functions.map((f) => ({ tool: `build_${f.name}`, src: 'contract', write: true, on: rw })),
    { tool: 'submit_transaction', src: 'contract', write: true, on: rw },
    { tool: 'search_functions', src: 'docs', write: false, on: true },
    { tool: 'get_docs', src: 'docs', write: false, on: true }
  ];
  const rows = tools.map((t, i) => ({
    num: <S.Numeral index={i + 1} />, tool: t.tool, src: t.src,
    kind: <S.Chip tone={t.write ? 'inverse' : 'neutral'}>{t.write ? 'Write' : 'Read'}</S.Chip>,
    on: <S.Chip tone={t.on ? 'good' : 'neutral'}>{t.on ? 'On' : 'Off'}</S.Chip>
  }));
  const config = mcpConfig(c);
  const oneLiner = `claude mcp add --transport http sonata-${slugOf(c)} ${c.urls.mcp}`;
  return (
    <>
      <div>
        <Label>Endpoint</Label>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.urls.mcp}</span>
          <CopyButton S={S} text={c.urls.mcp}>Copy</CopyButton>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <S.Segmented ariaLabel="Scope" options={SCOPES} value={scope} onChange={change} />
        <span className="sn-small sn-muted">
          {saving ? 'Saving…' : err ? `Couldn't change scope: ${err.message}` : rw ? 'Write tools are enabled. Agents can build unsigned transactions and submit signed ones.' : 'Write tools stay disabled until you enable them explicitly. Agents never hold keys.'}
        </span>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Tools · {tools.filter((t) => t.on).length} enabled</Label>
        <ResponsiveTable S={S} columns={COLS} rows={rows} minWidth={760} />
      </div>
      <div style={{ maxWidth: 976 }}>
        <Label>Connect an agent</Label>
        <div style={{ marginTop: 16 }}>
          <CodeBox right={<CopyButton S={S} text={config}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
          </CodeBox>
        </div>
        <div style={{ marginTop: 12 }}>
          <CodeBox right={<CopyButton S={S} text={oneLiner}>Copy</CopyButton>}>
            <div className="sn-mono" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{oneLiner}</div>
          </CodeBox>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <CopyButton S={S} variant="secondary" text={config}>Claude</CopyButton>
          <CopyButton S={S} variant="secondary" text={config}>Cursor</CopyButton>
          <CopyButton S={S} variant="secondary" text={config}>Codex</CopyButton>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Build + manual check, commit**

Run: `npm run build`. Manual: MCP tab shows `18 enabled` in ro (16 call + 2 docs tools), `build_*` rows Off; switch to Read + write → PATCH → `35 enabled`, the shell's MCP tab count updates to 35 after refetch; the config JSON names `sonata-kitchensink`; `claude mcp add …` line present. Simulate a PATCH failure by stopping the API → scope reverts and the inline error shows.

```bash
git add components/workspace/Mcp.jsx components/data.js
git commit -m "site: mcp tab toggles scope and lists real tools"
```

---

### Task 9: Public contract page

**Files:**
- Modify: `app/explorer/[id]/page.jsx`, `components/screens/ContractPublic.jsx` (rewrite)
- Modify: `components/explorer-data.js` (keep; `PUBLIC_FNS` stays for the demo fallback)

**Interfaces:**
- Consumes: `contracts.get/urls`, `useApi`, `<Async>`, `<PreviewBar>`, `mcpConfig`/`slugOf` (exported from `Mcp.jsx`), `CONTRACT_BY_ID` demo catalogue.

- [ ] **Step 1: Route with server-side metadata**

`app/explorer/[id]/page.jsx`:
```jsx
import ContractPublic from '@/components/screens/ContractPublic';
import { CONTRACT_BY_ID } from '@/components/explorer-data';
import { pageMeta } from '@/components/seo';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

async function fetchContract(id) {
  try {
    const res = await fetch(`${API_URL}/c/${id}`, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    if (!res.ok) return null;
    const c = await res.json();
    return c.status === 'ready' ? c : null;
  } catch { return null; }
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const live = await fetchContract(id);
  if (live) {
    const name = live.name || id.slice(0, 4) + '…' + id.slice(-4);
    return pageMeta({ title: `${name} · Explorer`, description: `${name} on Stellar ${live.network}: ${live.functions.length} functions as a REST API, MCP tools and AI-ready docs.`, path: `/explorer/${id}` });
  }
  const c = CONTRACT_BY_ID[id];
  if (c) return pageMeta({ title: c.name + ' · Explorer', description: c.d + ' ' + c.fns + ' functions, ' + c.tools + ' MCP tools, ' + c.category + ' on ' + c.net + '.', path: '/explorer/' + c.id });
  return pageMeta({ title: 'Contract', path: '/explorer' });
}

export default async function Page({ params }) {
  const { id } = await params;
  return <ContractPublic id={id} demo={CONTRACT_BY_ID[id] || null} />;
}
```
(`generateStaticParams` is removed; the demo catalogue ids are still served via the `demo` fallback.)

- [ ] **Step 2: Screen**

`components/screens/ContractPublic.jsx`:
```jsx
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSonataUI } from '@/lib/sonata';
import { contracts, shortId, relTime } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import Async from '@/components/Async';
import PreviewBar from '@/components/PreviewBar';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { mcpConfig } from '@/components/workspace/Mcp';
import { PUBLIC_FNS, fmt } from '@/components/explorer-data';

const FN_COLS = [
  { key: 'num', header: '', width: '56px' }, { key: 'fn', header: 'Function', width: '150px', strong: true },
  { key: 'sig', header: 'Signature', mono: true }, { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];
const sig = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;

function Live({ S, c, router }) {
  const config = mcpConfig(c);
  const rows = c.functions.map((f, i) => ({ num: <S.Numeral index={i + 1} />, fn: f.name, sig: sig(f), kind: <S.Chip tone={f.kind === 'write' ? 'inverse' : 'neutral'}>{f.kind === 'write' ? 'Write' : f.kind === 'read' ? 'Read' : '—'}</S.Chip> }));
  const name = c.name || shortId(c.id);
  return (
    <>
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{name}</h1>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <CopyButton S={S} text={c.id}>Copy</CopyButton>
            <S.Chip tone={c.network === 'mainnet' ? 'inverse' : 'neutral'}>{c.network === 'mainnet' ? 'Mainnet' : 'Testnet'}</S.Chip>
          </div>
        </div>
        <div className="actions">
          <S.Button variant="secondary" onClick={() => router.push(`/c/${c.id}/overview`)}>Open workspace</S.Button>
          <CopyButton S={S} variant="primary" arrow text={c.urls.mcp}>Copy MCP URL</CopyButton>
        </div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Functions" value={String(c.functions.length)} />
        <S.Stat label="MCP tools" value={String(c.mcp_scope === 'rw' ? c.functions.length * 2 + 3 : c.functions.length + 2)} />
        <S.Stat label="Types" value={String(c.types.length)} />
        <S.Stat label="Updated" value={relTime(c.updated_at)} />
      </div>
      <div className="two-col">
        <div>
          <Label style={{ marginBottom: 16 }}>About</Label>
          <S.KeyValueList rows={[
            { key: 'Network', value: c.network, mono: false }, { key: 'Spec', value: 'SEP-48' },
            { key: 'AI docs', value: <a className="crumb" href={c.urls.llms} target="_blank" rel="noreferrer">llms.txt</a> },
            { key: 'OpenAPI', value: <a className="crumb" href={c.urls.openapi} target="_blank" rel="noreferrer">openapi.json</a> },
            { key: 'Base URL', value: c.urls.base }
          ]} />
        </div>
        <div>
          <Label style={{ marginBottom: 16 }}>Connect an agent</Label>
          <CodeBox right={<CopyButton S={S} text={config}>Copy</CopyButton>}>
            <pre className="sn-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--sn-font-mono)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{config}</pre>
          </CodeBox>
          <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Read tools work without a key. Write tools are enabled per contract from its workspace.</div>
        </div>
      </div>
      <div>
        <Label style={{ marginBottom: 16 }}>Functions · {c.functions.length}</Label>
        <ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} />
      </div>
    </>
  );
}

function Demo({ S, c, router }) {   // the previous demo rendering, unchanged in substance
  const base = `${contracts.urls(c.id).base}`;
  const rows = PUBLIC_FNS.slice(0, c.fns).map((f, i) => ({ num: <S.Numeral index={i + 1} />, fn: f[0], sig: f[1], kind: <S.Chip tone={f[2] ? 'inverse' : 'neutral'}>{f[2] ? 'Write' : 'Read'}</S.Chip> }));
  return (
    <>
      <PreviewBar />
      <div className="page-head" style={{ gap: 24 }}>
        <div style={{ minWidth: 0, maxWidth: '100%' }}>
          <h1 className="sn-h1">{c.name}</h1>
          <p className="sn-body sn-muted" style={{ marginTop: 10, maxWidth: 560 }}>{c.d}</p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span className="sn-mono" style={{ overflowWrap: 'anywhere' }}>{c.id}</span>
            <S.Chip tone={c.net === 'Mainnet' ? 'inverse' : 'neutral'}>{c.net}</S.Chip>
            {c.verified && <S.Chip tone="good">Verified</S.Chip>}
          </div>
        </div>
        <div className="actions"><S.Button variant="secondary" onClick={() => router.push(`/register?id=${c.id}`)}>Register to your workspace</S.Button></div>
      </div>
      <div className="sn-stat-row">
        <S.Stat label="Calls · 30d" value={fmt(c.calls)} /><S.Stat label="Functions" value={String(c.fns)} /><S.Stat label="MCP tools" value={String(c.tools)} /><S.Stat label="Category" value={c.category} />
      </div>
      <div><Label style={{ marginBottom: 16 }}>Functions · {c.fns}</Label><ResponsiveTable S={S} columns={FN_COLS} rows={rows} minWidth={760} /></div>
      <div className="sn-small sn-muted">Base URL {base} · sample listing; register the contract to get its real API.</div>
    </>
  );
}

export default function ContractPublic({ id, demo }) {
  const S = useSonataUI();
  const router = useRouter();
  const { data, error, loading, refetch } = useApi(() => contracts.get(id), [id]);
  if (!S) return null;
  const live = data && data.status === 'ready' ? data : null;
  const notFound = error && error.status === 404;
  return (
    <main className="page">
      <div className="sn-label sn-muted"><Link className="crumb" href="/explorer">Explorer</Link> / {live ? (live.name || shortId(id)) : demo ? demo.name : shortId(id)}</div>
      {live ? <Live S={S} c={live} router={router} />
        : notFound && demo ? <Demo S={S} c={demo} router={router} />
        : notFound ? (
          <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}>
            <div className="sn-body" style={{ fontWeight: 700 }}>This contract isn't registered with Sonata.</div>
            <div style={{ marginTop: 16 }}><S.Button arrow onClick={() => router.push(`/register?id=${id}`)}>Register it</S.Button></div>
          </div>
        ) : <Async S={S} loading={loading} error={error} onRetry={refetch}>{data && <Demo S={S} c={demo || { id, name: shortId(id), d: 'Registration in progress.', net: 'Testnet', fns: 0, tools: 0, calls: 0, category: '—' }} router={router} />}</Async>}
    </main>
  );
}
```
Remove `FN_COLS`, `API_URL` usages from `components/data.js` if nothing else imports them (`data.js` keeps `API_URL`/`SITE_URL` for SEO and `DocsPage`).

- [ ] **Step 3: Build + manual check, commit**

Run: `npm run build`. Manual: `/explorer/CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP` → live page (16 functions, `<title>` contains `KitchenSink · Explorer` — check the tab title / `curl -s localhost:3000/explorer/<id> | grep -o '<title>[^<]*'`); `/explorer/CGA4VK53W6R2XPLZ7SM3NQ7TRH24JC7SFK3D5TPZ2XQ7WVN6M6ABCD4R` (demo id) → demo rendering with the preview bar; `/explorer/CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4` → "isn't registered" + Register button.

```bash
git add "app/explorer/[id]/page.jsx" components/screens/ContractPublic.jsx components/data.js
git commit -m "site: public contract page renders registered contracts, demo fallback"
```

---

### Task 10: Config, README, CI, build hygiene

**Files:**
- Modify: `README.md`, `components/data.js` (final prune), `.github/workflows/site.yml` (create)

- [ ] **Step 1: README + env**

`README.md` — replace the "Notes" section with:
```
## Notes
- Live screens (Register, Contracts, contract workspace, public contract page) talk to the Sonata API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`; run `server/` locally, see `server/README.md`). Set the variable in Vercel to `https://api.sonata.brages.uk`.
- History, Flows, the Explorer catalogue and Keys still use demo data and show the preview bar.
- The UI kit loads client-side only, so screens render after mount (`useSonataUI()` returns null during SSR).
- Tests: `npm test` (vitest, lib layer) · `npm run test:e2e` (Playwright, needs the API + site running).
```
and add `- `lib/api.js`, `lib/useApi.js`, `lib/args.js` — API client, data hooks, argument-form helpers` to the Structure list; change the `/c/[tab]` line to `/c/[id]/[tab]`.

- [ ] **Step 2: Final prune of `components/data.js`**

For each export in `data.js`, `grep -rn "<NAME>" app components lib --include=*.js --include=*.jsx`; delete exports with no importer. Expected survivors: `SITE_URL`, `API_URL`, `LLMS`, `MCP_CONFIG`, `MCP_URL` (DocsPage), `EV*`/`ADDR*`/`HIST_OPTS` (History demo), `NET_OPTS`, `TAB_LABEL`, `WELCOME_ROWS`/`PIPE` if Welcome uses them. Run `npm run build` after — a missing import fails the build.

- [ ] **Step 3: CI**

`.github/workflows/site.yml`:
```yaml
name: site
on:
  push: { paths: ['app/**', 'components/**', 'lib/**', 'test/site/**', 'package.json', 'package-lock.json', 'vitest.config.mjs', '.github/workflows/site.yml'] }
  pull_request: { paths: ['app/**', 'components/**', 'lib/**', 'test/site/**', 'package.json', 'package-lock.json'] }
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build
        env: { NEXT_PUBLIC_API_URL: https://api.sonata.brages.uk }
```

- [ ] **Step 4: Verify + commit**

Run: `npm test && npm run build`
Expected: 19 tests PASS; build OK with no "unused"/missing-module warnings.

```bash
git add README.md components/data.js .github/workflows/site.yml
git commit -m "site: readme, data prune, ci workflow"
```

---

### Task 11: Playwright smoke flow

**Files:**
- Create: `playwright.config.js`, `e2e/site.spec.ts`, `e2e/README.md`

**Interfaces:**
- Consumes: a running API (`cd server && docker compose up -d db && npm run dev`) and site (`npm run dev`), the testnet fixture id.

- [ ] **Step 1: Config**

`playwright.config.js`:
```js
// @ts-check
const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: process.env.SITE_URL || 'http://localhost:3000', trace: 'retain-on-failure' },
  reporter: [['list']]
});
```
`npx playwright install chromium` once (document in `e2e/README.md`).

- [ ] **Step 2: The flow**

`e2e/site.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

const ID = process.env.E2E_CONTRACT_ID || 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const G = process.env.E2E_SOURCE || 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

test('register → workspace → simulate → build → mcp → docs → public page', async ({ page }) => {
  await page.goto(`/register?id=${ID}`);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByRole('button', { name: 'Open contract workspace' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Open contract workspace' }).click();

  await expect(page).toHaveURL(new RegExp(`/c/${ID}/overview`));
  await expect(page.getByText('Functions', { exact: false }).first()).toBeVisible();
  await page.getByRole('tab', { name: /Functions/ }).click();

  await page.getByRole('button', { name: 'add', exact: true }).click();
  await page.getByLabel('a').fill('5');
  await page.getByLabel('b').fill('7');
  await page.getByRole('button', { name: 'Simulate' }).click();
  await expect(page.getByText('"12"')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'ping', exact: true }).click();
  await page.getByLabel('who').fill(G);
  await page.getByLabel('n').fill('1');
  await page.getByLabel('source').fill(G);
  await page.getByRole('radio', { name: 'Build transaction' }).or(page.getByText('Build transaction')).first().click();
  await page.getByRole('button', { name: 'Build unsigned XDR' }).click();
  await expect(page.getByText('Unsigned XDR')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^AAAA/)).toBeVisible();

  await page.getByRole('tab', { name: /MCP/ }).click();
  await page.getByText('Read + write').click();
  await expect(page.getByText(/enabled/)).toContainText('35', { timeout: 15_000 });

  await page.getByRole('tab', { name: /Docs/ }).click();
  await expect(page.locator('pre')).toContainText('# ', { timeout: 15_000 });

  await page.goto(`/explorer/${ID}`);
  await expect(page.getByText(`/c/${ID}/mcp`)).toBeVisible();
  await expect(page.getByText('Functions · 16')).toBeVisible();
});
```
If the kit's `Segmented` renders buttons rather than radios, replace the `Build transaction` locator with `page.getByRole('button', { name: 'Build transaction' })` — inspect the DOM once with `npx playwright codegen http://localhost:3000` and pin the selector that works; do not leave an `.or()` fallback in the committed test. Same for the tab role (`Tabs` may render `role="tab"` or buttons).

`e2e/README.md`: prerequisites (Postgres + API on :8080, site on :3000, `npx playwright install chromium`), the env vars (`E2E_CONTRACT_ID`, `E2E_SOURCE`, `SITE_URL`), and the command `npm run test:e2e`.

- [ ] **Step 3: Run it, commit**

Run (three terminals): `cd server && npm run dev` · `npm run dev` · `npm run test:e2e`
Expected: 1 test passed. Then `git status` shows no `test-results/` (ignored).

```bash
git add playwright.config.js e2e
git commit -m "site: playwright smoke flow against the local api"
```

---

## Done when

- `npm test` green (lib layer), `npm run build` clean, `npm run test:e2e` passes against the local API.
- On the deployed site with `NEXT_PUBLIC_API_URL` set: registering a testnet contract from `/register` lands in a workspace where `/call` and `/tx` work and the MCP config copies a real URL; `/explorer/{id}` unfurls with the contract's name.
- Demo screens still work and show the preview bar; the nav shows no fake wallet.
