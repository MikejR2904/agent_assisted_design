import { Router } from 'express';
import { ModelRouter } from '../models/ModelRouter';
import { logger } from '../utils/logger';

// Models often wrap code in a fence even when explicitly told not to — strip one leading/
// trailing ```lang / ``` pair if present, rather than trying to prompt it away perfectly.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : trimmed;
}

export function aiRouter(): Router {
  const router = Router();
  const modelRouter = ModelRouter.getInstance();

  // POST /api/ai/explain { code, language }
  router.post('/explain', async (req, res) => {
    try {
      const { code, language } = req.body as { code: string; language?: string };
      if (!code?.trim()) return res.status(400).json({ error: 'code required' });
      const systemPrompt = `You are a concise code-explanation assistant for ${language ?? 'code'}. ` +
        `Explain what the given code does in a short, clear paragraph (under 150 words). ` +
        `No code in your response, no markdown headers — plain prose only.`;
      const explanation = await modelRouter.summarize([{ role: 'user', content: code }], systemPrompt);
      res.json({ explanation: explanation.trim() || 'No explanation could be generated.' });
    } catch (err) {
      logger.error('AI explain error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/ai/refactor { code, language }
  router.post('/refactor', async (req, res) => {
    try {
      const { code, language } = req.body as { code: string; language?: string };
      if (!code?.trim()) return res.status(400).json({ error: 'code required' });
      const systemPrompt = `You are a ${language ?? 'code'} refactoring assistant. Rewrite the given code ` +
        `with the same behavior but improved clarity, style, and idiomatic conventions. ` +
        `Respond with ONLY the rewritten code — no explanation, no markdown fences, no commentary.`;
      const refactored = await modelRouter.summarize([{ role: 'user', content: code }], systemPrompt);
      res.json({ refactored: stripCodeFence(refactored) });
    } catch (err) {
      logger.error('AI refactor error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/ai/fix { code, language, diagnostic: { message, line } }
  router.post('/fix', async (req, res) => {
    try {
      const { code, language, diagnostic } = req.body as {
        code: string;
        language?: string;
        diagnostic?: { message: string; line: number };
      };
      if (!code?.trim()) return res.status(400).json({ error: 'code required' });
      const diagnosticText = diagnostic
        ? `The following diagnostic was reported on line ${diagnostic.line}: "${diagnostic.message}". Fix it.`
        : 'Fix any issues you find.';
      const systemPrompt = `You are a ${language ?? 'code'} bug-fixing assistant. ${diagnosticText} ` +
        `Make the minimal change needed. Respond with ONLY the corrected code — no explanation, ` +
        `no markdown fences, no commentary.`;
      const fixed = await modelRouter.summarize([{ role: 'user', content: code }], systemPrompt);
      res.json({ fixed: stripCodeFence(fixed) });
    } catch (err) {
      logger.error('AI fix error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/ai/complete { prefix, suffix, language }
  router.post('/complete', async (req, res) => {
    try {
      const { prefix, suffix, language } = req.body as { prefix: string; suffix?: string; language?: string };
      if (!prefix?.trim()) return res.status(400).json({ error: 'prefix required' });
      const systemPrompt = `You are an inline code-completion engine for ${language ?? 'code'}, used for ` +
        `ghost-text suggestions as the user types. Given the code before and after the cursor, respond ` +
        `with ONLY the short text that should be inserted at the cursor to continue the code naturally — ` +
        `typically one line or a few tokens. Do NOT repeat any of the given prefix or suffix. No ` +
        `explanation, no markdown fences. If nothing sensible completes the code, respond with an empty string.`;
      const userContent = suffix
        ? `<prefix>\n${prefix}\n</prefix>\n<suffix>\n${suffix}\n</suffix>`
        : `<prefix>\n${prefix}\n</prefix>`;
      const completion = await modelRouter.summarize([{ role: 'user', content: userContent }], systemPrompt);
      res.json({ completion: stripCodeFence(completion) });
    } catch (err) {
      logger.error('AI complete error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
