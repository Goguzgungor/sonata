import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { ApiError } from '../errors.js';
import type { Deps } from './deps.js';
import { contractRoutes } from './routes/contracts.js';
import { invokeRoutes } from './routes/invoke.js';
import { docsRoutes } from './routes/docs.js';
import { healthRoutes } from './routes/health.js';
import { registerMcp } from '../mcp/route.js';

/** `rateLimitMax` exists for tests only — production always gets the documented 120/min. */
export function buildApp(deps: Deps, opts: { rateLimitMax?: number } = {}) {
  // trustProxy: behind Fly's proxy req.ip — and so the rate-limit key — must be the client, not the edge (review finding I3).
  const app = Fastify({ trustProxy: true, loggerInstance: deps.log, genReqId: () => crypto.randomUUID(), bodyLimit: 1_000_000 });
  app.register(cors, { origin: (origin, cb) => cb(null, !origin || deps.cfg.corsOrigins.includes(origin) || deps.cfg.corsOrigins.includes('*')), methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] });
  app.register(rateLimit, { max: opts.rateLimitMax ?? 120, timeWindow: '1 minute' });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send(err.toJSON());
    if (err instanceof ZodError) {
      const path = err.issues[0]?.path.join('.');   // same `details.path` convention as spec/codec.ts's CodecError
      return reply.code(400).send({ error: 'invalid_args', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), details: { ...(path ? { path } : {}), issues: err.issues } });
    }
    if ((err as any).statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'too many requests' });
    if ((err as any).validation || (err as any).statusCode === 400) return reply.code(400).send({ error: 'invalid_args', message: (err as Error).message });
    req.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: 'internal', message: 'internal error', details: { request_id: req.id } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'route_not_found', message: `${req.method} ${req.url} is not a route` }));
  app.register(contractRoutes(deps));
  app.register(invokeRoutes(deps));
  app.register(docsRoutes(deps));
  app.register(healthRoutes(deps));
  registerMcp(app, deps);
  return app;
}
