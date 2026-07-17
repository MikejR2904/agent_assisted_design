import { Router } from 'express';
import { TelemetryService } from '../services/TelemetryService';

export function telemetryRouter(telemetryService: TelemetryService): Router {
  const router = Router();

  // GET /api/telemetry/session/:sessionId
  router.get('/session/:sessionId', (req, res) => {
    const metrics = telemetryService.getSessionMetrics(req.params.sessionId);
    if (!metrics) return res.status(404).json({ error: 'Session not found' });
    res.json(metrics);
  });

  // GET /api/telemetry/experiment/:sessionId/metrics — thesis metrics: human correction rate,
  // first-pass acceptance rate, PPA drift across physical-design tool runs in the session.
  router.get('/experiment/:sessionId/metrics', (req, res) => {
    const metrics = telemetryService.getExperimentMetrics(req.params.sessionId);
    res.json(metrics);
  });

  // GET /api/telemetry/logs — list available per-session logs (same `${condition}_${sessionId}
  // .jsonl` naming the old on-disk JSONL files used, now backed by the DB).
  router.get('/logs', (_req, res) => {
    res.json(telemetryService.listSessionLogFiles());
  });

  // GET /api/telemetry/logs/:filename — download a session's full event log, reconstructed as
  // JSONL from the DB (previously streamed straight off disk).
  router.get('/logs/:filename', (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9_.-]/g, ''); // defense in depth, no path segments possible anyway since this isn't a filesystem lookup anymore
    const match = filename.match(/^.+_([0-9a-fA-F-]{36})\.jsonl$/);
    if (!match) return res.status(404).json({ error: 'Log file not found' });

    const events = telemetryService.getEventsForSession(match[1]);
    if (events.length === 0) return res.status(404).json({ error: 'Log file not found' });

    const content = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  });

  return router;
}
