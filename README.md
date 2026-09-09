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
- `app/` — routes: `/`, `/register`, `/contracts`, `/c/[tab]` (overview · functions · mcp · docs · history), `/keys`
- `app/globals.css` — site layout classes; `app/sonata.css` — @sonata/ui tokens + component styles
- `components/screens/` + `components/workspace/` — one component per screen/tab
- `components/data.js` — all demo data in one place
- `lib/sonata-bundle.js` — the @sonata/ui component bundle (client-only, exposes `window.SonataUI`)
- `lib/sonata.js` — `useSonataUI()` hook + clipboard/download helpers

## Notes
- The UI kit loads client-side only, so screens render after mount (`useSonataUI()` returns null during SSR). 
- Front-end only: no real wallet connection or chain data.
