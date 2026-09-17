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
