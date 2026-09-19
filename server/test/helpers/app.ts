import pino from 'pino';
import { buildApp } from '../../src/http/app.js';
import { loadConfig } from '../../src/config.js';
import { MemoryStore } from '../../src/registry/store.js';
import { Registry } from '../../src/registry/registry.js';
import { llmsTxt } from '../../src/docs/llms.js';
import { openapi } from '../../src/docs/openapi.js';
import { loadAuthKeys } from '../../src/auth/keys.js';
import { ChallengeVerifier } from '../../src/auth/challenge.js';
import { HistoryService } from '../../src/history/service.js';
import { FakeChain } from './fakeChain.js';
import { FakeHistorySource } from './fakeHistory.js';
import { FIXTURE_ID } from '../fixtures/index.js';

export const OWNER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

export async function testApp(envOverrides: NodeJS.ProcessEnv = {}, opts: { rateLimitMax?: number } = {}) {
  const cfg = loadConfig({ DATABASE_URL: 'postgres://unused', PUBLIC_BASE_URL: 'https://api.sonata.test', RPC_URL_MAINNET: 'https://mainnet.example', ...envOverrides });
  const chain = new FakeChain();
  const store = new MemoryStore();
  const registry = new Registry({ store, chain, gen: { llmsTxt: (m) => llmsTxt(m, cfg), openapi: (m) => openapi(m, cfg) } });
  const keys = await loadAuthKeys(store, {});
  const challenge = { signing: keys.signing, homeDomain: cfg.authHomeDomain, webAuthDomain: 'api.sonata.test' };
  const auth = { keys, challenge, verifier: new ChallengeVerifier(challenge) };
  const historySource = new FakeHistorySource();
  const history = new HistoryService(historySource, (id) => registry.ready(id), { ttlMs: 10_000 });
  const app = buildApp({ cfg, chain, registry, store, log: pino({ level: 'silent' }), auth, history }, opts);
  await app.ready();
  const registerFixture = async () => { await registry.register(FIXTURE_ID, 'testnet', 'KitchenSink', OWNER); await registry.whenIdle(); };
  return { app, chain, store, registry, cfg, auth, history, historySource, registerFixture };
}
