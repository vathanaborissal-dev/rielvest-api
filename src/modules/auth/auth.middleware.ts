import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../../core/errors.ts';
import { verifyAccessToken } from './auth.tokens.ts';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return req.cookies?.['rielvest_access'] ?? null;
}

/** Rejects the request unless a valid access token is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) {
    next(unauthorized('Sign in to access this resource.'));
    return;
  }
  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, email: claims.email };
    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches the user when a token is present, but never rejects the request. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (token) {
    try {
      const claims = verifyAccessToken(token);
      req.user = { id: claims.sub, email: claims.email };
    } catch {
      // An expired token on a public endpoint is just an anonymous visitor.
    }
  }
  next();
}

export function currentUserId(req: Request): string {
  if (!req.user) throw unauthorized();
  return req.user.id;
}
