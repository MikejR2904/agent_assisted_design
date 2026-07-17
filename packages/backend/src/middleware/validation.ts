import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';

// Generic request-body validator. On failure, passes an AppError to next() (handled by the
// existing errorHandlerMiddleware) instead of each route hand-rolling its own 400 response. On
// success, replaces req.body with the parsed/defaulted data so downstream handlers get the
// Zod-coerced shape (defaults filled in, extra keys stripped) rather than the raw body.
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ');
      next(new AppError(
        `Validation failed: ${detail}`,
        ErrorCategory.VALIDATION,
        false,
        `Invalid request: ${detail}`,
      ));
      return;
    }
    req.body = parsed.data;
    next();
  };
}
