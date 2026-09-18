# e2e

Playwright smoke test that drives the real site against the real local API:
register a testnet contract, open its workspace, simulate a read call, build
an unsigned transaction, flip the MCP scope, check the generated docs, then
check that the public explorer page reflects the same contract.

## Prerequisites

1. Postgres running and migrated, API on `:8080`:
   ```sh
   cd server
   docker compose up -d db
   npm run db:migrate
   npm run dev
   ```
2. Site on `:3000` (from the repo root):
   ```sh
   npm run dev
   ```
3. Chromium for Playwright (once):
   ```sh
   npx playwright install chromium
   ```

## Env vars

- `E2E_CONTRACT_ID` — testnet contract id to register/open. Defaults to the
  deployed KitchenSink fixture `CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP`.
  That fixture is already registered with an unchanged WASM hash in most
  environments, so the register pipeline short-circuits straight to
  Done/Done/Done/Skipped — the test still passes either way, it just doesn't
  wait through a full index.
- `E2E_SOURCE` — a syntactically valid G... account used as the `who`/`source`
  params when building an unsigned transaction (never signed or submitted).
  Defaults to `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF`.
- `SITE_URL` — base URL for the site under test. Defaults to
  `http://localhost:3000`.
- `E2E_API_URL` — the Sonata API the site talks to, used directly by the test
  to reset the fixture's MCP scope afterwards. Falls back to
  `NEXT_PUBLIC_API_URL`, then `http://localhost:8080`.

## Notes

- The test reads the contract's function count from the workspace's
  `Functions N` tab and derives every count it asserts from it (`Tools ·
  2N+3 enabled` after switching to read+write, `Functions · N` on the public
  page), so a fixture with a different number of functions still passes.
- It flips the fixture's MCP scope to read+write; an `afterEach` PATCHes it
  back to `ro`, so reruns start from the read-only default.

## Run

```sh
npm run test:e2e
```
