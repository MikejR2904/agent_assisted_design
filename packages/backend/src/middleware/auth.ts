import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ConfigManager } from '../config/ConfigManager';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';
import type { UserRole } from '../db/repositories/UserRepository';

export interface AuthTokenPayload {
  sub: string; // user id
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole };
    }
  }
}

export function signToken(payload: AuthTokenPayload): string {
  const { jwtSecret, tokenExpiryMinutes } = ConfigManager.getInstance().get().auth;
  return jwt.sign(payload, jwtSecret!, { expiresIn: `${tokenExpiryMinutes}m` });
}

// Applied per-route (not globally on /api/*) — see the design note in the plan: auth is additive
// to this app's existing unauthenticated flows, not a breaking gate in front of everything.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    next(new AppError('Missing Authorization header', ErrorCategory.AUTHENTICATION, false, 'Authentication required.'));
    return;
  }

  const { jwtSecret } = ConfigManager.getInstance().get().auth;
  try {
    const payload = jwt.verify(token, jwtSecret!) as AuthTokenPayload;
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    next(new AppError('Invalid or expired token', ErrorCategory.AUTHENTICATION, false, 'Your session has expired. Please log in again.'));
  }
};

// Like requireAuth, but never rejects — attaches req.user if a valid token is present, otherwise
// leaves it undefined and continues. Used on routes that work unauthenticated but change
// behavior (ownership filtering) when a caller is identified.
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) return next();

  const { jwtSecret } = ConfigManager.getInstance().get().auth;
  try {
    const payload = jwt.verify(token, jwtSecret!) as AuthTokenPayload;
    req.user = { id: payload.sub, role: payload.role };
  } catch {
    // An invalid/expired token on an optional-auth route is treated as "not authenticated"
    // rather than an error — the route still works unauthenticated.
  }
  next();
};
