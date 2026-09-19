import { getSession, clearSession } from './session';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

export const PASSPHRASES = { testnet: 'Test SDF Network ; September 2015', mainnet: 'Public Global Stellar Network ; September 2015' };

export class ApiError extends Error {
  constructor(status, error, message, extra = {}) {
    super(message);
    this.status = status; this.error = error; this.code = extra.code; this.details = extra.details;
  }
}

/** JSON in/out against the Sonata API. Non-2xx → ApiError from the server envelope; fetch failure → ApiError(0, 'network'). */
export async function api(path, { method = 'GET', body, signal, text = false } = {}) {
  let res;
  try {
    const session = getSession();
    const headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(session ? { authorization: `Bearer ${session.token}` } : {}) };
    res = await fetch(API_URL + path, {
      method, signal,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', `Can't reach the API at ${API_URL}`);
  }
  if (!res.ok) {
    if (res.status === 401) clearSession();
    let env = null;
    try { env = await res.json(); } catch (_) { /* not JSON */ }
    if (env && typeof env.error === 'string') throw new ApiError(res.status, env.error, env.message || env.error, { code: env.code, details: env.details });
    throw new ApiError(res.status, 'http_' + res.status, `${method} ${path} failed with HTTP ${res.status}`);
  }
  if (text) return res.text();
  if (res.status === 204) return null;
  try { return await res.json(); }
  catch (_) { throw new ApiError(res.status, 'bad_response', 'API returned a non-JSON response'); }
}

/** Builds "?a=b&c=d" from an object, skipping undefined/null/'' values; '' when nothing is left. */
const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, v);
  }
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const contracts = {
  list: ({ mine = false, ...o } = {}) => api(mine ? '/contracts?owner=me' : '/contracts', o),
  register: (id, network, name, o) => api('/contracts', { ...o, method: 'POST', body: name ? { id, network, name } : { id, network } }),
  get: (id, o) => api(`/c/${encodeURIComponent(id)}`, o),
  status: (id, o) => api(`/c/${encodeURIComponent(id)}/status`, o),
  patch: (id, patch, o) => api(`/c/${encodeURIComponent(id)}`, { ...o, method: 'PATCH', body: patch }),
  call: (id, fn, args, source, o) => api(`/c/${encodeURIComponent(id)}/call/${encodeURIComponent(fn)}`, { ...o, method: 'POST', body: source ? { args, source } : { args } }),
  tx: (id, fn, args, source, opts = {}, o) => api(`/c/${encodeURIComponent(id)}/tx/${encodeURIComponent(fn)}`, { ...o, method: 'POST', body: { args, source, ...opts } }),
  submit: (id, xdr, o) => api(`/c/${encodeURIComponent(id)}/submit`, { ...o, method: 'POST', body: { xdr } }),
  llms: (id, o) => api(`/c/${encodeURIComponent(id)}/llms.txt`, { ...o, text: true }),
  /** Decoded events over the last ~7 days: params ⊂ { type, address, from, to, cursor, limit }. */
  events: (id, params, o) => api(`/c/${encodeURIComponent(id)}/events${qs(params)}`, o),
  /** Same query, as a direct download link (format=csv always wins). */
  eventsCsvUrl: (id, params) => `${API_URL}/c/${encodeURIComponent(id)}/events${qs({ ...params, format: 'csv' })}`,
  urls: (id) => ({ base: `${API_URL}/c/${encodeURIComponent(id)}`, mcp: `${API_URL}/c/${encodeURIComponent(id)}/mcp`, llms: `${API_URL}/c/${encodeURIComponent(id)}/llms.txt`, openapi: `${API_URL}/c/${encodeURIComponent(id)}/openapi.json` })
};

/** The one global MCP endpoint: every registered contract, on any network. */
export const mcpGlobalUrl = API_URL + '/mcp';
export const mcpGlobalConfig = JSON.stringify({ mcpServers: { sonata: { url: mcpGlobalUrl, type: 'http' } } }, null, 2);
export const mcpGlobalOneLiner = `claude mcp add --transport http sonata ${mcpGlobalUrl}`;

export const auth = {
  challenge: (address, network, o) => api('/auth/challenge', { ...o, method: 'POST', body: { address, network } }),
  token: (transaction, network, o) => api('/auth/token', { ...o, method: 'POST', body: { transaction, network } }),
  me: (o) => api('/auth/me', o)
};
export const health = (o) => api('/healthz', o);
export const shortAddr = (g) => (g ? g.slice(0, 4) + '…' + g.slice(-4) : '');

/** MCP tools a contract exposes: `call_*` per function, plus `build_*` per function and `submit_transaction` in rw, plus `search_functions`, `get_docs` and `get_events`. */
export const mcpToolCount = (c) => (c.mcp_scope === 'rw' ? c.functions.length * 2 + 4 : c.functions.length + 3);

export const shortId = (id) => id.slice(0, 4) + '…' + id.slice(-4);
export const isContractId = (s) => /^C[A-Z2-7]{55}$/.test(s || '');
export const isAccountId = (s) => /^G[A-Z2-7]{55}$/.test(s || '');
export const relTime = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
};
