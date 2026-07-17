import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';
import type { UserRole } from '../db/repositories/UserRepository';

// Must run after requireAuth (relies on req.user being set — 403s if it's missing rather than
// silently treating that as "no access", since that would indicate a route wiring bug).
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new AppError('requireRole used without requireAuth', ErrorCategory.CONFIG, false, 'Authentication required.'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new AppError(
        `User role "${req.user.role}" is not permitted (requires one of: ${roles.join(', ')})`,
        ErrorCategory.AUTHORIZATION,
        false,
        'You do not have permission to perform this action.',
      ));
      return;
    }
    next();
  };
}
