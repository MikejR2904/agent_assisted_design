import { Router } from 'express';
import { z } from 'zod';
import path from 'path';
import { RagService } from '../services/RagService';
import { ConfigManager } from '../config/ConfigManager';
import { logger } from '../utils/logger';

const RAG_SOURCES_DIR = path.resolve(process.cwd(), '../../rag_sources');

const QuerySchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).optional(),
});

export function ragRouter(): Router {
  const router = Router();
  const ragService = RagService.getInstance();

  // GET /api/rag/status
  router.get('/status', (_req, res) => {
    const { rag } = ConfigManager.getInstance().get();
    res.json({
      available: ragService.isAvailable(),
      enabled: rag.enabled,
      collectionName: rag.collectionName,
      qdrantUrl: rag.qdrantUrl,
    });
  });

  // POST /api/rag/ingest — re-scans rag_sources/ for .md/.txt files
  router.post('/ingest', async (_req, res) => {
    try {
      const result = await ragService.ingestDirectory(RAG_SOURCES_DIR);
      res.json(result);
    } catch (err) {
      logger.error('RAG ingestion failed', { error: (err as Error).message });
      res.status(500).json({ error: 'RAG ingestion failed' });
    }
  });

  // POST /api/rag/query — manual test endpoint
  router.post('/query', async (req, res) => {
    const parsed = QuerySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    try {
      const results = await ragService.query(parsed.data.query, parsed.data.topK);
      res.json({ results });
    } catch (err) {
      logger.error('RAG query failed', { error: (err as Error).message });
      res.status(500).json({ error: 'RAG query failed' });
    }
  });

  return router;
}
