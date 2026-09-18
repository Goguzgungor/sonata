export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080').replace(/\/+$/, '');

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
    res = await fetch(API_URL + path, {
      method, signal,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', `Can't reach the API at ${API_URL}`);
  }
  if (!res.ok) {
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

export const contracts = {
  list: (o) => api('/contracts', o),
  register: (id, network, name, o) => api('/contracts', { ...o, method: 'POST', body: name ? { id, network, name } : { id, network } }),
  get: (id, o) => api(`/c/${id}`, o),
  status: (id, o) => api(`/c/${id}/status`, o),
  patch: (id, patch, o) => api(`/c/${id}`, { ...o, method: 'PATCH', body: patch }),
  call: (id, fn, args, source, o) => api(`/c/${id}/call/${fn}`, { ...o, method: 'POST', body: source ? { args, source } : { args } }),
  tx: (id, fn, args, source, opts = {}, o) => api(`/c/${id}/tx/${fn}`, { ...o, method: 'POST', body: { args, source, ...opts } }),
  llms: (id, o) => api(`/c/${id}/llms.txt`, { ...o, text: true }),
  urls: (id) => ({ base: `${API_URL}/c/${id}`, mcp: `${API_URL}/c/${id}/mcp`, llms: `${API_URL}/c/${id}/llms.txt`, openapi: `${API_URL}/c/${id}/openapi.json` })
};

/** MCP tools a contract exposes: `call_*` per function, plus `build_*` per function and `submit_transaction` in rw, plus `search_functions` + `get_docs`. */
export const mcpToolCount = (c) => (c.mcp_scope === 'rw' ? c.functions.length * 2 + 3 : c.functions.length + 2);

export const shortId = (id) => id.slice(0, 4) + '…' + id.slice(-4);
export const isContractId = (s) => /^C[A-Z2-7]{55}$/.test(s || '');
export const isAccountId = (s) => /^G[A-Z2-7]{55}$/.test(s || '');
export const relTime = (iso) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
};
