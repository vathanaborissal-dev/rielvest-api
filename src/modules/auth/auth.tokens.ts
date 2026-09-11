import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.ts';
import { unauthorized } from '../../core/errors.ts';

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.jwtSecret, {
    expiresIn: env.accessTokenTtl as jwt.SignOptions['expiresIn'],
    issuer: 'rielvest',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.jwtSecret, { issuer: 'rielvest' });
    if (typeof payload === 'string' || !payload.sub) throw new Error('malformed token');
    return { sub: String(payload.sub), email: String((payload as jwt.JwtPayload).email ?? '') };
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

/**
 * Refresh tokens are opaque random strings; only their SHA-256 digest is
 * stored, so a database leak cannot be replayed as a live session.
 */
export function createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(48).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + env.refreshTokenDays * 86_400_000),
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
