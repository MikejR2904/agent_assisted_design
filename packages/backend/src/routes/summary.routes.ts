import { Router } from 'express';
import { z } from 'zod';
import { ModelRouter } from '../models/ModelRouter';
import type { AgentSummary } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

const SummaryRequestSchema = z.object({
  projectId: z.string().uuid(),
  agentId: z.string().uuid(),
  sessionIds: z.array(z.string()),
  messagesForSessions: z.record(
    z.array(z.object({ role: z.string(), content: z.string() })),
  ),
});

export function summaryRouter(): Router {
  const router = Router();
  const modelRouter = ModelRouter.getInstance();
  router.post('/', async (req, res) => {
    const parsed = SummaryRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }
    const { projectId, agentId, sessionIds, messagesForSessions } = parsed.data;
    // Build conversation transcript
    let totalInputTokens = 0;
    const transcript = sessionIds
      .map((sid) => {
        const msgs = messagesForSessions[sid] ?? [];
        if (msgs.length === 0) return null;
        const lines = msgs
          .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 2000)}`)
          .join('\n');
        // Rough token estimate: 1 token ≈ 4 chars for English
        totalInputTokens += Math.ceil(lines.length / 4);
        return `=== Session ${sid.slice(0, 8)} ===\n${lines}`;
      })
      .filter(Boolean)
      .join('\n\n');
    if (!transcript.trim()) {
      return res.status(400).json({ error: 'No messages found in the provided sessions' });
    }
    // Truncate to avoid token limits (approx 80k chars)
    const truncated = transcript.length > 80_000
      ? transcript.slice(0, 80_000) + '\n\n[TRANSCRIPT TRUNCATED]'
      : transcript;

    try {
      // Use the ModelRouter.summarize method (tries free models first)
      const userPrompt = `Analyse the following conversation transcript and provide a concise summary of key points, decisions, and unresolved issues:\n\n${truncated}`;
      const messages = [{ role: 'user' as const, content: userPrompt }];
      const summaryText = await modelRouter.summarize(messages);
      // If summarization returns empty, use a fallback
      const finalSummary = summaryText && summaryText.length > 10
        ? summaryText
        : 'Summary could not be generated. Please try again later.';
      const summary: AgentSummary = {
        projectId,
        agentId,
        summaryText: finalSummary,
        tokensUsed: Math.round(totalInputTokens * 0.15), // estimate output tokens
        timestamp: new Date().toISOString(),
      };
      logger.info('Summary generated', { agentId, projectId, sessions: sessionIds.length, tokens: totalInputTokens });
      res.json(summary);
    } catch (err) {
      logger.error('Summary generation failed', { err: (err as Error).message });
      res.status(500).json({ error: `Summary generation failed: ${(err as Error).message}` });
    }
  });

  return router;
}
