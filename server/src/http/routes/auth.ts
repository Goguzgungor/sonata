import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import { buildChallenge } from '../../auth/challenge.js';
import { issueToken } from '../../auth/jwt.js';
import { requireSession } from '../session.js';

const NETWORK = z.enum(['testnet', 'mainnet']);
const ChallengeBody = z.object({ address: z.string(), network: NETWORK });
const TokenBody = z.object({ transaction: z.string().min(1), network: NETWORK });

export const authRoutes = (deps: Deps): FastifyPluginAsync => async (app) => {
  app.post('/auth/challenge', async (req) => {
    const b = ChallengeBody.parse(req.body);
    const c = buildChallenge(deps.auth.challenge, b.address, b.network);
    return { transaction: c.transaction, network_passphrase: c.networkPassphrase };
  });
  app.post('/auth/token', async (req) => {
    const b = TokenBody.parse(req.body);
    const address = deps.auth.verifier.verify(b.transaction, b.network);
    const t = await issueToken(deps.auth.keys.secret, deps.cfg.publicBaseUrl, address);
    req.log.info({ address }, 'session issued');
    return { token: t.token, address, expires_at: t.expiresAt };
  });
  app.get('/auth/me', async (req) => {
    const s = await requireSession(deps, req);
    return { address: s.address, expires_at: s.expiresAt };
  });
};
