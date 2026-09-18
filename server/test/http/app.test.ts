import { describe, it, expect } from 'vitest';
import { testApp } from '../helpers/app.js';

describe('rate limiting behind a proxy', () => {
  // trustProxy: on Fly every request arrives from the edge, so without it req.ip — and therefore the
  // rate-limit key — would be the proxy and one noisy client would exhaust the budget for everyone.
  it('keys the limiter on the forwarded client address, not the proxy', async () => {
    const { app } = await testApp({}, { rateLimitMax: 2 });
    const hit = (ip: string) => app.inject({ method: 'GET', url: '/contracts', headers: { 'x-forwarded-for': ip } });
    expect((await hit('203.0.113.9')).statusCode).toBe(200);
    expect((await hit('203.0.113.9')).statusCode).toBe(200);
    const limited = await hit('203.0.113.9');
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'rate_limited', message: 'too many requests' });
    expect((await hit('198.51.100.7')).statusCode).toBe(200);   // a different client still has its own budget
  });
});
