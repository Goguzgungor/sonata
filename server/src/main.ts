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
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await pool.end();
  process.exit(0);
});
