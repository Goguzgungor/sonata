import { describe, it, expect } from 'vitest';
import { testApp } from '../helpers/app.js';
import { FIXTURE_ID, loadFixtureWasm } from '../fixtures/index.js';

describe('docs routes', () => {
  it('serves llms.txt as markdown and openapi.json', async () => {
    const { app, registerFixture } = await testApp(); await registerFixture();
    const l = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` });
    expect(l.statusCode).toBe(200); expect(l.headers['content-type']).toMatch(/text\/markdown/); expect(l.body).toMatch(/^# KitchenSink/);
    const o = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/openapi.json` });
    expect(o.json().openapi).toBe('3.1.0');
  });
  it('unknown contract is 404', async () => {
    const { app } = await testApp();
    expect((await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` })).statusCode).toBe(404);
  });
  it('GET /c/:id/llms.txt is 409 contract_not_ready while the registration pipeline is still running', async () => {
    const { app, chain, registry } = await testApp();
    chain.impl.getContractWasm = () => new Promise((resolve) => setTimeout(() => resolve(loadFixtureWasm()), 300));
    await registry.register(FIXTURE_ID, 'testnet', 'KitchenSink');
    const res = await app.inject({ method: 'GET', url: `/c/${FIXTURE_ID}/llms.txt` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('contract_not_ready');
    await registry.whenIdle();
  });
});
