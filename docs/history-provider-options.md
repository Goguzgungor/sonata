# History data provider for Sonata M4 (Stellar / Soroban)

**Date:** 2026-09-18 · **Status:** research + recommendation (no decision taken yet)

## What M4 needs
- Per-contract event + call history from the contract's first ledger, kept current as ledgers close.
- Decoded events (we can decode XDR topics/data ourselves — the SEP-48 spec + codec already exist in `server/src/spec`).
- Filters: event type, address, ledger/time range; address activity; stats; CSV/JSON; MCP `get_events`.
- Contracts register at runtime, so history for a *newly* registered contract must be obtainable after the fact (backfill).
- Both testnet and mainnet.

## The constraint that shapes everything
Stellar RPC keeps only a bounded window of events — default `history-retention-window` = 120 960 ledgers ≈ **7 days** — and "archive" RPC offerings today only extend `getLedgers`, not `getEvents`. Anything older must come from an indexer, a data lake, or our own ingestion of ledger metadata. Horizon is being deprecated and never carried Soroban events.

## Candidates

| Provider | What it gives | History depth | Delivery / API | Cost | Fit for M4 |
|---|---|---|---|---|---|
| **Mercury** (Stellar-native, xycLoo) | Contract events + Soroban txs for mainnet & testnet; webhooks (filter/HMAC/retry); Mercury RPC; Retroshades (custom WASM indexing, Pro) | They ingest and store all events for both networks — depth not stated in docs; **verify in the 14-day trial** | REST: `GET /events/by-contract/{id}?from=&to=&limit=`, filter by topics/tx hash; offset + cursor pagination; topics/data returned as XDR-base64 (we decode) | Dev free (testnet only) · **Builder $79/mo** (mainnet+testnet) · Pro $129/mo (Retroshades) · Protocol custom; 14-day trial, money-back 2 months; pricing still labelled a draft | **Best fit** if history is deep: on registration, page the contract's events into our Postgres, then webhook/poll for the live tail. Flat price, no ingestion infra. Risks: small vendor, API/pricing churn |
| **Goldsky Mirror / Turbo Pipelines** | Managed streaming of Stellar datasets (`ledgers`, `transactions`, `operations`, `events`, `transfers`, `ledger_entries`, `balances`) into our Postgres/ClickHouse/S3/Kafka; reorg handling; `events` has `contract_id`, `topics` (JSON), `data` (JSON) | Backfill via `start_at: <ledger>` (Soroban mainnet genesis ≈ ledger 50M, Feb 2024) | We own the table — our query API/stats/CSV are plain SQL | Free: 750 pipeline-hours + 1M events/mo; then $0.10/worker-hour (~$73/mo) + $1 per 100k events written | Strong second. One always-on pipeline for *all* mainnet events makes newly registered contracts' history instantly available, but ingesting everything costs per event (tens of millions of Soroban events since 2024 → hundreds of $ one-off backfill) and DB growth is ours to manage; filtering the pipeline to registered contracts instead means re-backfilling on each registration |
| **Hubble** (SDF, BigQuery `crypto_stellar.history_contract_events`) | Full history, `topics_decoded` / `data_decoded` JSON, partitioned by month, clustered by `contract_id`; free public dataset, pay per query | Complete | SQL via BigQuery; batch (Airflow, intraday) — explicitly *not* for real-time | BigQuery on-demand query cost only (cheap per contract thanks to clustering) | Ideal **deep-backfill** source; cannot serve the live tail. Hybrid = Hubble backfill + RPC `getEvents` for the last 7 days → our Postgres |
| **Own indexer on RPC** | `getEvents` polling per registered contract into our Postgres | 7 days only, unless we also pull `getLedgers` from an archive RPC (Ankr, Gateway, Validation Cloud, Lightsail, OnFinality, GetBlock, node101, Obsrvr, Exaion) and extract events from ledger close meta ourselves | Ours | RPC provider fee only | Cheapest to run, most engineering (ledger-meta parsing, gap/cursor handling, reorg-safe ingestion). Not worth it for M4 |
| **Obsrvr Lake / Flow / Gateway** | REST `/silver/events` "events by contract or topic", `/silver/contracts/top`, hot + cold (Parquet/DuckLake) storage; Flow = managed custom pipelines; Gateway = RPC | Full history claimed (cold storage) | REST with API key | "Chat with sales"; Flow is private beta | Promising, Stellar-focused; too early to bet M4 on. Re-check in a quarter |
| **SubQuery / OnFinality** | Custom indexer project (manifest with `contractId` + `topics` filters, `startBlock`); hosted on OnFinality | Limited by the RPC it reads (needs an archive endpoint for backfill) | GraphQL from our own project | ~$0.08/deployment-hour (~$58/mo) + storage | Built for one schema per project, awkward for arbitrary runtime-registered contracts. Skip |
| Alchemy Stellar Data API · Allium · Space and Time · Dune / Bitquery · Stellar Expert | Portfolio/transfer-centric or analytics products; Stellar Expert has **no** contract-events endpoint | — | — | — | Not a fit for arbitrary-contract event history |

## Recommendation
1. **Trial Mercury Builder first** (14 days, no card). The one question to answer in the trial: *how far back can `events/by-contract` reach on mainnet?* Query a 2024 ledger range for a known contract (e.g. Soroswap router). If it returns data → adopt Mercury as the M4 source: backfill each contract into our own `events` table on registration, keep it current via Mercury webhooks (fallback: poll by ledger range). Our Postgres remains the serving layer (filters, address activity, stats, CSV/JSON, MCP `get_events`), so a later provider swap only touches the ingestion adapter.
2. **If Mercury's history is shallow**, keep the same serving layer and use the hybrid: Hubble BigQuery for the one-off deep backfill per contract (decoded columns, clustered by `contract_id` → cheap) + RPC `getEvents` polling for the live tail (well inside the 7-day window). No per-event streaming fees.
3. Keep **Goldsky** as the "we want everything, ours, now" option if per-event cost is acceptable — it removes all backfill logic at the price of ingesting the whole network.

Either way the code shape is the same: an `ingest/` module with a `HistorySource` interface (`backfill(contractId, fromLedger)`, `tail(contractId, sinceLedger)`), one adapter per provider, and the decode step reusing `spec/codec.ts`.

## Sources
- Stellar RPC retention & getEvents limits: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents · https://developers.stellar.org/docs/data/apis/rpc/admin-guide/configuring · https://developers.stellar.org/docs/build/guides/events/ingest
- RPC providers & archive matrix: https://developers.stellar.org/docs/data/apis/rpc/providers
- Indexers overview: https://developers.stellar.org/docs/data/indexers
- Mercury: https://docs.mercurydata.app/genaral-info/pricing.md · https://docs.mercurydata.app/mercury-classic/queries/1.-contract-events · https://docs.mercurydata.app/retroshades/introduction-to-retroshades
- Goldsky: https://docs.goldsky.com/turbo-pipelines/sources/stellar · https://goldsky.com/pricing
- Hubble: https://developers.stellar.org/docs/data/analytics/hubble · https://developers.stellar.org/docs/data/analytics/hubble/data-catalog/data-dictionary/bronze/history-contract-events
- Obsrvr: https://docs.withobsrvr.com/docs/lake/overview/ · https://www.withobsrvr.com/pricing
- SubQuery / OnFinality: https://subquery.network/doc/indexer/quickstart/quickstart_chains/stellar-soroban.html · https://documentation.onfinality.io/support/pricing
- Stellar Expert Open API (no contract endpoints): https://stellar.expert/openapi
