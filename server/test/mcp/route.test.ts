import { describe, it, expect, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { testApp } from '../helpers/app.js';
import { signInAs, bearer } from '../helpers/session.js';
import { FIXTURE_ID } from '../fixtures/index.js';

// Each test assigns the app it created here; afterEach closes it unconditionally (fastify's
// close() is safe whether or not the app ever listen()ed), so neither test can leak a listener
// regardless of which one(s) call listen() — a shared `close` set by only one test risked that.
let app: Awaited<ReturnType<typeof testApp>>['app'] | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe('ALL /c/:id/mcp', () => {
  it('serves MCP over Streamable HTTP, stateless, honoring the stored scope', async () => {
    const t = await testApp();
    app = t.app;
    const { token } = await signInAs(t.app, Keypair.random());
    await t.app.inject({ method: 'POST', url: '/contracts', payload: { id: FIXTURE_ID, network: 'testnet', name: 'KitchenSink' }, headers: bearer(token) });
    await t.registry.whenIdle();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as any).port;
    const url = new URL(`http://127.0.0.1:${port}/c/${FIXTURE_ID}/mcp`);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    expect((await client.listTools()).tools.some((x) => x.name === 'build_ping')).toBe(false);
    await client.close();
    await t.app.inject({ method: 'PATCH', url: `/c/${FIXTURE_ID}`, payload: { mcp_scope: 'rw' }, headers: bearer(token) });
    const client2 = new Client({ name: 't', version: '0' });
    await client2.connect(new StreamableHTTPClientTransport(url));
    expect((await client2.listTools()).tools.some((x) => x.name === 'build_ping')).toBe(true);
    const r = await client2.callTool({ name: 'call_get_count', arguments: {} });
    expect(r.structuredContent).toMatchObject({ simulated: true });
    await client2.close();
  });
  it('returns the JSON error envelope for unknown / not-ready contracts', async () => {
    const t = await testApp();
    app = t.app;
    const res = await t.app.inject({ method: 'POST', url: '/c/CNOPE/mcp', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    expect(res.statusCode).toBe(404); expect(res.json().error).toBe('contract_not_found');
  });
});

describe('ALL /mcp', () => {
  it('serves the global server over Streamable HTTP, stateless', async () => {
    const t = await testApp(); app = t.app; await t.registerFixture();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (t.app.server.address() as any).port;
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('list_contracts');
    const r = await client.callTool({ name: 'get_contract', arguments: { id: FIXTURE_ID } });
    expect(r.structuredContent).toMatchObject({ id: FIXTURE_ID });
    await client.close();
  });
});
