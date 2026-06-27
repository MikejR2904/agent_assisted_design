import express from 'express';
import cors from 'cors';
import { agentsRouter } from './routes/agents.routes';
import { filesRouter } from './routes/files.routes';
import { telemetryRouter } from './routes/telemetry.routes';
import { workspaceRouter } from './routes/workspace.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { projectsRouter } from './routes/projects.routes';
import { summaryRouter } from './routes/summary.routes';
import { TelemetryService } from './services/TelemetryService';
import { logger } from './utils/logger';
import path from 'path';
import type { Orchestrator } from './orchestrator/Orchestrator';
import { SessionService } from './services/SessionService';
import { ProjectService } from './services/ProjectService';

const TELEMETRY_ROOT = process.env.TELEMETRY_ROOT ?? path.resolve(process.cwd(), '../../telemetry');
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? path.resolve(process.cwd(), '../../workspaces');
const BASELINE_DIR = path.join(WORKSPACE_ROOT, 'baseline_stub');

export function createApp(orchestrator?: Orchestrator): express.Application {
  const app = express();
  const telemetryService = TelemetryService.getInstance(TELEMETRY_ROOT);
  const sessionService = new SessionService(TELEMETRY_ROOT);
  const projectService = new ProjectService(TELEMETRY_ROOT, WORKSPACE_ROOT, BASELINE_DIR);

  app.use(cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  }));

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api/agents', agentsRouter());
  app.use('/api/files', filesRouter());
  app.use('/api/telemetry', telemetryRouter(telemetryService));
  app.use('/api/sessions', sessionsRouter(sessionService));
  app.use('/api/projects', projectsRouter(projectService));
  app.use('/api/agents/summary', summaryRouter());

  // Workspace routes (require orchestrator)
  if (orchestrator) {
    app.use('/api/workspace', workspaceRouter(orchestrator));
  }

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('Unhandled error', { err: err.message, stack: err.stack });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}