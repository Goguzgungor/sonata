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
    fetch.mockImplementation(() => json(200, {}));
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
