import type { ErrorRequestHandler } from 'express';
import { AppError } from './AppError';
import { ErrorCategory } from './ErrorTypes';
import { logger } from '../utils/logger';

const STATUS_BY_CATEGORY: Record<ErrorCategory, number> = {
  [ErrorCategory.VALIDATION]: 400,
  [ErrorCategory.LLM_PROVIDER]: 502,
  [ErrorCategory.NETWORK]: 502,
  [ErrorCategory.TOOL_EXECUTION]: 500,
  [ErrorCategory.CONFIG]: 500,
};

// Global Express error handler. Most routes still catch their own errors and respond inline
// (pre-existing pattern, unchanged) — this is the last-resort net for anything that propagates,
// now returning a typed { error, category, retryable } body instead of a flat string for
// AppErrors, while preserving the old generic-500 shape for anything else.
export function errorHandlerMiddleware(): ErrorRequestHandler {
  return (err: Error, _req, res, _next) => {
    if (err instanceof AppError) {
      logger.error('Unhandled AppError', {
        message: err.message,
        category: err.category,
        retryable: err.retryable,
        stack: err.stack,
      });
      res.status(STATUS_BY_CATEGORY[err.category]).json({
        error: err.userMessage,
        category: err.category,
        retryable: err.retryable,
      });
      return;
    }

    logger.error('Unhandled error', { err: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  };
}

// Retries `fn` only when it throws a retryable AppError — a plain Error or a non-retryable
// AppError fails fast. Intended for genuinely transient failures (e.g. a momentary fs error),
// not for re-running an operation whose failure is a real result (a failing lint/PnR run, which
// resolves as data rather than throwing, and shouldn't be retried here).
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 200;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const canRetry = err instanceof AppError && err.retryable && attempt < attempts;
      if (!canRetry) throw err;
      logger.warn(`Retrying after transient error (attempt ${attempt}/${attempts})`, {
        error: (err as Error).message,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}
