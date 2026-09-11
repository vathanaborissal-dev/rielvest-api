import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { AppError, badRequest } from './errors.ts';
import { logger } from './logger.ts';

const log = logger('http');

/** Wraps an async controller so rejected promises reach the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function formatZodError(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Validates a request part, converting failures into a 400 with field detail. */
export function validate<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(`Invalid ${label}`, formatZodError(result.error));
  return result.data;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}` },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: { code: 'bad_request', message: 'Invalid request', details: formatZodError(error) },
    });
    return;
  }

  // Prisma surfaces unique-constraint violations as P2002; treat as a conflict
  // rather than leaking a 500 for a situation the caller can fix.
  const prismaCode = (error as { code?: string } | null)?.code;
  if (prismaCode === 'P2002') {
    res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists.' },
    });
    return;
  }
  if (prismaCode === 'P2025') {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
    return;
  }

  log.error('unhandled error', error);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Something went wrong on our side.' },
  });
}
