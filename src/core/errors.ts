export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(message, 400, 'bad_request', details);

export const unauthorized = (message = 'Sign in to continue.') =>
  new AppError(message, 401, 'unauthorized');

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError(message, 403, 'forbidden');

export const notFound = (message = 'Not found.') => new AppError(message, 404, 'not_found');

export const conflict = (message: string, details?: unknown) =>
  new AppError(message, 409, 'conflict', details);

export const unprocessable = (message: string, details?: unknown) =>
  new AppError(message, 422, 'unprocessable', details);

export const upstreamUnavailable = (message: string, details?: unknown) =>
  new AppError(message, 503, 'upstream_unavailable', details);
