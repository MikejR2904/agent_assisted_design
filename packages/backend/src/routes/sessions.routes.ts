import { Router } from 'express';
import { SessionService } from '../services/SessionService';

export function sessionsRouter(sessionService: SessionService): Router {
  const router = Router();

  // GET /api/sessions
  router.get('/', async (_req, res) => {
    const sessions = await sessionService.readSessions();
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
  router.post('/', async (req, res) => {
    const { id, condition, agentIds, title } = req.body;
    if (!id || !condition) {
      return res.status(400).json({ error: 'id and condition are required' });
    }
    const session = await sessionService.createSession(id, condition, agentIds || [], title);
    res.json(session);
  });

  // PUT /api/sessions/:id/title
  router.put('/:id/title', async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    await sessionService.updateSessionTitle(req.params.id, title);
    res.json({ success: true });
  });

  // DELETE /api/sessions/:id
  router.delete('/:id', async (req, res) => {
    await sessionService.deleteSession(req.params.id);
    res.status(204).send();
  });

  return router;
}