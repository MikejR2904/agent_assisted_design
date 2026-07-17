import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository } from '../db/repositories/UserRepository';
import { validateBody } from '../middleware/validation';
import { requireAuth, signToken } from '../middleware/auth';
import { logger } from '../utils/logger';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const BCRYPT_ROUNDS = 10;

export function authRouter(): Router {
  const router = Router();
  const users = new UserRepository();

  // POST /api/auth/register
  router.post('/register', validateBody(RegisterSchema), async (req, res) => {
    const { email, password } = req.body;
    if (users.findByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = {
      id: uuidv4(),
      email,
      passwordHash,
      role: 'engineer' as const,
      createdAt: new Date().toISOString(),
    };
    users.create(user);
    logger.info('User registered', { userId: user.id, email });

    const token = signToken({ sub: user.id, role: user.role });
    res.status(201).json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  // POST /api/auth/login
  router.post('/login', validateBody(LoginSchema), async (req, res) => {
    const { email, password } = req.body;
    const user = users.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  // POST /api/auth/refresh — re-issues a token for the caller's already-valid credentials.
  router.post('/refresh', requireAuth, (req, res) => {
    const token = signToken({ sub: req.user!.id, role: req.user!.role });
    res.json({ token });
  });

  return router;
}
