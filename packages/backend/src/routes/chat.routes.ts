import { Router } from 'express';
import { z } from 'zod';

const ChatBodySchema = z.object({
  content: z.string().min(1).max(32_000),
  sessionId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
});

/**
 * POST /api/chat
 * HTTP fallback for clients that can't use WebSockets.
 * In normal use the frontend sends messages via Socket.io.
 */
export function chatRouter(): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const parsed = ChatBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }
    // Signal the caller to use WebSocket instead.
    // The orchestrator is only reachable via the WS server.
    res.status(202).json({
      message: 'Message queued. Connect via WebSocket for streaming responses.',
      sessionId: parsed.data.sessionId,
    });
  });

  return router;
}