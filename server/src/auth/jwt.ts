import { SignJWT, jwtVerify } from 'jose';

export const SESSION_TTL_S = 24 * 3600;
export type Session = { address: string; expiresAt: string };

export async function issueToken(secret: Uint8Array, issuer: string, address: string, now = Date.now()): Promise<{ token: string; expiresAt: string }> {
  const iat = Math.floor(now / 1000); const exp = iat + SESSION_TTL_S;
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(address).setIssuer(issuer).setIssuedAt(iat).setExpirationTime(exp).sign(secret);
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

/** null for anything that is not a currently valid token issued by us — callers turn that into 401. */
export async function verifyToken(secret: Uint8Array, issuer: string, token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer, algorithms: ['HS256'] });
    if (!payload.sub || !payload.exp) return null;
    return { address: payload.sub, expiresAt: new Date(payload.exp * 1000).toISOString() };
  } catch { return null; }
}
