# Sonata — Next.js site

Sonata demo front-end (Soroban contract → REST API, MCP server, docs, indexed history) as a Next.js 15 App Router project, styled with @sonata/ui.

## Run locally
```bash
npm install
npm run dev   # http://localhost:3000
```

## Deploy to Vercel
Push to a git repo and import at vercel.com/new (framework auto-detected), or:
```bash
npx vercel --prod
```

## Structure
- `app/` — routes: `/`, `/register`, `/contracts`, `/c/[id]/[tab]` (overview · functions · mcp · docs · history), `/explorer`, `/explorer/[id]`, `/flows`, `/docs`, `/keys`
- `app/globals.css` — site layout classes; `app/sonata.css` — @sonata/ui tokens + component styles
- `components/screens/` + `components/workspace/` — one component per screen/tab
- `components/data.js` — demo data for the screens that still use it (plus `explorer-data.js`, `flows-data.js`, `home-data.js`, `docs-data.js`)
- `lib/api.js`, `lib/useApi.js`, `lib/args.js` — API client, data hooks, argument-form helpers
- `lib/sonata-bundle.js` — the @sonata/ui component bundle (client-only, exposes `window.SonataUI`)
- `lib/sonata.js` — `useSonataUI()` hook + clipboard/download helpers
- `server/` — the API + MCP server (Node/Fastify/Postgres). See `server/README.md`.

## Notes
- Live screens (Register, Contracts, contract workspace, public contract page) talk to the Sonata API at `NEXT_PUBLIC_API_URL` (default `http://localhost:8080`; run `server/` locally, see `server/README.md`). Set the variable in Vercel to `https://api.sonata.brages.uk`.
- History, Flows, the Explorer catalogue and Keys still use demo data and show the preview bar.
- The UI kit loads client-side only, so screens render after mount (`useSonataUI()` returns null during SSR).
- Tests: `npm test` (vitest, lib layer) · `npm run test:e2e` (Playwright, needs the API + site running).
