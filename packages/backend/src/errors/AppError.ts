import { ErrorCategory } from './ErrorTypes';

// Structured error carrying enough information for callers to decide whether to retry, how to
// log it, and what's safe to show a user — as opposed to a bare Error, which conflates all of
// that into an unstructured message string.
export class AppError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly retryable = false,
    // Never leak internal detail (paths, stack fragments) to a client by default — callers that
    // want to surface something specific pass their own safe userMessage.
    public readonly userMessage = 'Something went wrong. Please try again.',
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
