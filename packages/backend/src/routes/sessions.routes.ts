import { Router, type Request } from 'express';
import { SessionService } from '../services/SessionService';
import { SessionCreateSchema, SessionTitleUpdateSchema } from '@agent_design/shared/types';
import { validateBody } from '../middleware/validation';
import { optionalAuth } from '../middleware/auth';

// "Owner" filter: undefined for unauthenticated or admin callers (unfiltered — today's
// behavior), otherwise the caller's own id (their sessions + pre-existing unowned ones).
function ownerFilterFor(req: Request): string | undefined {
  return req.user && req.user.role !== 'admin' ? req.user.id : undefined;
}

export function sessionsRouter(sessionService: SessionService): Router {
  const router = Router();
  router.use(optionalAuth);

  // GET /api/sessions
  router.get('/', async (req, res) => {
    const sessions = await sessionService.readSessions(ownerFilterFor(req));
    // Return only metadata (omit messages to reduce payload)
    const list = sessions.map(({ messages, ...rest }) => rest);
    res.json(list);
  });

  // GET /api/sessions/:id
  router.get('/:id', async (req, res) => {
    const session = await sessionService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  // POST /api/sessions (create or update)
  router.post('/', validateBody(SessionCreateSchema), async (req, res) => {
    const { id, condition, agentIds, title, projectId } = req.body;
    const session = await sessionService.createSession(id, condition, agentIds, title, projectId, req.user?.id);
    res.json(session);
  });

  // PUT /api/sessions/:id/title
  router.put('/:id/title', validateBody(SessionTitleUpdateSchema), async (req, res) => {
    await sessionService.updateSessionTitle(req.params.id, req.body.title);
    res.json({ success: true });
  });

  // DELETE /api/sessions/:id
  router.delete('/:id', async (req, res) => {
    await sessionService.deleteSession(req.params.id);
    res.status(204).send();
  });

  return router;
}
