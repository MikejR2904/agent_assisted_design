import { Router } from 'express';
import path from 'path';
import { GitService } from '../services/GitService';
import { ModelRouter } from '../models/ModelRouter';
import { logger } from '../utils/logger';
import { ConfigManager } from '../config/ConfigManager';

const { paths } = ConfigManager.getInstance().get();
const WORKSPACE_ROOT = paths.workspaceRoot ?? path.resolve(process.cwd(), '../../workspaces');

function gitServiceFor(condition?: string): GitService {
  const conditionDir = path.join(WORKSPACE_ROOT, `condition_${condition ?? 'agent-assisted'}`);
  return new GitService(conditionDir);
}

export function gitRouter(): Router {
  const router = Router();
  const modelRouter = ModelRouter.getInstance();

  // GET /api/git/status?condition=
  router.get('/status', async (req, res) => {
    try {
      const git = gitServiceFor(req.query.condition as string);
      await git.ensureRepo();
      const entries = await git.status();
      res.json({ entries });
    } catch (err) {
      logger.error('Git status error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/git/diff?condition=&path=&staged=
  router.get('/diff', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      const git = gitServiceFor(req.query.condition as string);
      await git.ensureRepo();
      const diff = await git.diff(filePath, req.query.staged === 'true');
      res.json({ diff });
    } catch (err) {
      logger.error('Git diff error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/git/show?condition=&path=&ref=HEAD — file content at a ref, for the diff viewer.
  router.get('/show', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      const git = gitServiceFor(req.query.condition as string);
      await git.ensureRepo();
      const content = await git.showFile(filePath, (req.query.ref as string) || 'HEAD');
      res.json({ content });
    } catch (err) {
      logger.error('Git show error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/git/log?condition=&path=
  router.get('/log', async (req, res) => {
    try {
      const git = gitServiceFor(req.query.condition as string);
      await git.ensureRepo();
      const entries = await git.log(req.query.path as string | undefined).catch(() => []);
      res.json({ entries });
    } catch (err) {
      logger.error('Git log error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/git/blame?condition=&path=
  router.get('/blame', async (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path required' });
      const git = gitServiceFor(req.query.condition as string);
      await git.ensureRepo();
      const lines = await git.blame(filePath).catch(() => []);
      res.json({ lines });
    } catch (err) {
      logger.error('Git blame error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/git/stage { condition, paths[] }
  router.post('/stage', async (req, res) => {
    try {
      const { condition, paths: filePaths } = req.body as { condition?: string; paths: string[] };
      if (!filePaths?.length) return res.status(400).json({ error: 'paths required' });
      const git = gitServiceFor(condition);
      await git.ensureRepo();
      await git.stage(filePaths);
      res.json({ success: true });
    } catch (err) {
      logger.error('Git stage error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/git/unstage { condition, paths[] }
  router.post('/unstage', async (req, res) => {
    try {
      const { condition, paths: filePaths } = req.body as { condition?: string; paths: string[] };
      if (!filePaths?.length) return res.status(400).json({ error: 'paths required' });
      const git = gitServiceFor(condition);
      await git.ensureRepo();
      await git.unstage(filePaths);
      res.json({ success: true });
    } catch (err) {
      logger.error('Git unstage error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/git/commit { condition, message }
  router.post('/commit', async (req, res) => {
    try {
      const { condition, message } = req.body as { condition?: string; message: string };
      if (!message?.trim()) return res.status(400).json({ error: 'message required' });
      const git = gitServiceFor(condition);
      await git.ensureRepo();
      const result = await git.commit(message.trim());
      res.json(result);
    } catch (err) {
      logger.error('Git commit error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/git/commit-message { condition } — AI-assisted; returns a suggestion,
  // does not commit. Reuses the same ModelRouter.summarize call shape as summary.routes.ts.
  router.post('/commit-message', async (req, res) => {
    try {
      const { condition } = req.body as { condition?: string };
      const git = gitServiceFor(condition);
      await git.ensureRepo();
      const diff = await git.diffStagedSummary();
      if (!diff.trim()) {
        return res.status(400).json({ error: 'No staged changes to summarize' });
      }
      const truncated = diff.length > 20_000 ? diff.slice(0, 20_000) + '\n[DIFF TRUNCATED]' : diff;
      const systemPrompt = 'You are a git commit message generator. Given a staged diff, respond with ' +
        'ONLY a single-line, conventional-commit-style message (under 72 characters, imperative mood). ' +
        'No explanation, no quotes, no markdown.';
      const message = await modelRouter.summarize([{ role: 'user', content: truncated }], systemPrompt);
      res.json({ message: message.trim().split('\n')[0] });
    } catch (err) {
      logger.error('Commit message generation error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
