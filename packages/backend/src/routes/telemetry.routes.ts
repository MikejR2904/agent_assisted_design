import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { TelemetryService } from '../services/TelemetryService';
import { ConfigManager } from '../config/ConfigManager';

const TELEMETRY_ROOT = ConfigManager.getInstance().get().paths.telemetryRoot
  ?? path.resolve(process.cwd(), '../../telemetry');

export function telemetryRouter(telemetryService: TelemetryService): Router {
  const router = Router();

  // GET /api/telemetry/session/:sessionId
  router.get('/session/:sessionId', (req, res) => {
    const metrics = telemetryService.getSessionMetrics(req.params.sessionId);
    if (!metrics) return res.status(404).json({ error: 'Session not found' });
    res.json(metrics);
  });

  // GET /api/telemetry/logs - list available JSONL files
  router.get('/logs', async (_req, res) => {
    try {
      const experimentsDir = path.join(TELEMETRY_ROOT, 'experiments');
      const files = await fs.readdir(experimentsDir).catch(() => []);
      const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
      res.json(jsonlFiles);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/telemetry/logs/:filename - download a JSONL file
  router.get('/logs/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename); // prevent traversal
      const filePath = path.join(TELEMETRY_ROOT, 'experiments', filename);
      const content = await fs.readFile(filePath, 'utf-8');
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(content);
    } catch (err) {
      res.status(404).json({ error: 'Log file not found' });
    }
  });

  return router;
}