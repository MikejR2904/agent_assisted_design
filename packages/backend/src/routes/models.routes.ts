import { Router } from 'express';
import { ModelRouter } from '../models/ModelRouter';
import { logger } from '../utils/logger';

export function modelsRouter(): Router {
  const router = Router();
  const modelRouter = ModelRouter.getInstance();

  // GET /api/models — flat list of every model exposed by an available provider. Providers are
  // registered in config-priority order, so this reflects that ordering without re-sorting here.
  router.get('/', async (_req, res) => {
    try {
      const models = await modelRouter.getRegistry().listModels();
      res.json({ models });
    } catch (err) {
      logger.error('Failed to list models', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to list models' });
    }
  });

  // GET /api/models/providers — provider metadata for grouping/badges in the frontend
  router.get('/providers', (_req, res) => {
    try {
      const statuses = modelRouter.getRegistry().getProviderStatuses();
      res.json({ providers: statuses });
    } catch (err) {
      logger.error('Failed to list providers', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to list providers' });
    }
  });

  return router;
}
