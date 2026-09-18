import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, contracts, auth, API_URL, shortId, isContractId, isAccountId, mcpToolCount, relTime } from '@/lib/api';
import { setSession, getSession, clearSession } from '@/lib/session';

const ID = 'CADY5JYDD7VE7M42HLGJILZAYRPJXPA7C7AOOJOLA44ECZDOA4NVULTP';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api()', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); clearSession(); });

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
  it('encodes id and fn path segments', async () => {
    fetch.mockImplementation(() => json(200, {}));
    await contracts.call(ID, 'weird fn/name', {});
    expect(fetch.mock.calls[0][0]).toBe(`${API_URL}/c/${ID}/call/weird%20fn%2Fname`);
    await contracts.get('C/weird?id');
    expect(fetch.mock.calls[1][0]).toBe(`${API_URL}/c/C%2Fweird%3Fid`);
  });
  it('200 with non-JSON body becomes ApiError', async () => {
    fetch.mockResolvedValue(new Response('not json', { status: 200 }));
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 200, error: 'bad_response' });
  });
  it('204 resolves to null', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await api('/x')).toBe(null);
  });
  it('AbortError is rethrown as-is', async () => {
    fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const err = await api('/x').catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(ApiError);
  });
  it('sends Authorization when a session exists and clears it on 401', async () => {
    setSession({ token: 'tok', address: 'GABC', expires_at: new Date(Date.now() + 60_000).toISOString() });
    fetch.mockResolvedValue(json(200, []));
    await contracts.list({ mine: true });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API_URL + '/contracts?owner=me');
    expect(init.headers.authorization).toBe('Bearer tok');
    fetch.mockResolvedValue(json(401, { error: 'unauthorized', message: 'nope' }));
    await expect(api('/auth/me')).rejects.toMatchObject({ status: 401, error: 'unauthorized' });
    expect(getSession()).toBeNull();
  });
  it('auth and submit helpers hit the right routes', async () => {
    fetch.mockImplementation(() => json(200, {}));
    await auth.challenge('GABC', 'testnet');
    expect(fetch.mock.calls[0][0]).toBe(API_URL + '/auth/challenge');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ address: 'GABC', network: 'testnet' });
    await auth.token('AAAA', 'mainnet');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ transaction: 'AAAA', network: 'mainnet' });
    await contracts.submit(ID, 'AAAA');
    expect(fetch.mock.calls[2][0]).toBe(`${API_URL}/c/${ID}/submit`);
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ xdr: 'AAAA' });
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
  it('mcpToolCount matches the server: N+2 read-only, 2N+3 read+write', () => {
    const c = (n, mcp_scope) => ({ mcp_scope, functions: Array.from({ length: n }, (_, i) => ({ name: `f${i}` })) });
    expect(mcpToolCount(c(15, 'ro'))).toBe(17);       // 15 call_* + search_functions + get_docs
    expect(mcpToolCount(c(15, 'rw'))).toBe(33);       // + 15 build_* + submit_transaction
    expect(mcpToolCount(c(0, 'ro'))).toBe(2);
    expect(mcpToolCount(c(0, 'rw'))).toBe(3);
  });
  it('relTime crosses just now / m / h / d on the boundary', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));
    const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
    expect(relTime(ago(0))).toBe('just now');
    expect(relTime(ago(59))).toBe('just now');
    expect(relTime(ago(60))).toBe('1m ago');
    expect(relTime(ago(3599))).toBe('59m ago');
    expect(relTime(ago(3600))).toBe('1h ago');
    expect(relTime(ago(86_399))).toBe('23h ago');
    expect(relTime(ago(86_400))).toBe('1d ago');
    expect(relTime(ago(3 * 86_400))).toBe('3d ago');
    expect(relTime(ago(-30))).toBe('just now');        // a clock ahead of ours clamps to 0
    vi.useRealTimers();
  });
});
