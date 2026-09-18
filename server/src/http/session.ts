import type { FastifyRequest } from 'fastify';
import type { Deps } from './deps.js';
import { ApiError } from '../errors.js';
import { verifyToken, type Session } from '../auth/jwt.js';

/** The session a request carries, or null when there is no (valid) bearer token. */
export async function sessionOf(deps: Deps, req: FastifyRequest): Promise<Session | null> {
  const h = req.headers.authorization;
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  return verifyToken(deps.auth.keys.secret, deps.cfg.publicBaseUrl, h.slice(7).trim());
}
export async function requireSession(deps: Deps, req: FastifyRequest): Promise<Session> {
  const s = await sessionOf(deps, req);
  if (!s) throw new ApiError(401, 'unauthorized', 'a valid "Authorization: Bearer <token>" header is required — sign in with your wallet first');
  return s;
}
