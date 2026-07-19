import express from 'express';
import cors from 'cors';
import { agentsRouter } from './routes/agents.routes';
import { filesRouter } from './routes/files.routes';
import { telemetryRouter } from './routes/telemetry.routes';
import { workspaceRouter } from './routes/workspace.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { projectsRouter } from './routes/projects.routes';
import { summaryRouter } from './routes/summary.routes';
import { modelsRouter } from './routes/models.routes';
import { providersRouter } from './routes/providers.routes';
import { ragRouter } from './routes/rag.routes';
import { authRouter } from './routes/auth.routes';
import { lintRouter } from './routes/lint.routes';
import { gitRouter } from './routes/git.routes';
import { TelemetryService } from './services/TelemetryService';
import path from 'path';
import type { Orchestrator } from './orchestrator/Orchestrator';
import { SessionService } from './services/SessionService';
import { ProjectService } from './services/ProjectService';
import { ConfigManager } from './config/ConfigManager';
import { errorHandlerMiddleware } from './errors/ErrorHandler';

const appConfig = ConfigManager.getInstance().get();
const TELEMETRY_ROOT = appConfig.paths.telemetryRoot ?? path.resolve(process.cwd(), '../../telemetry');
const WORKSPACE_ROOT = appConfig.paths.workspaceRoot ?? path.resolve(process.cwd(), '../../workspaces');
const BASELINE_DIR = path.join(WORKSPACE_ROOT, 'baseline_stub');

export function createApp(orchestrator?: Orchestrator): express.Application {
  const app = express();
  const telemetryService = TelemetryService.getInstance(TELEMETRY_ROOT);
  const sessionService = new SessionService(TELEMETRY_ROOT);
  const projectService = new ProjectService(TELEMETRY_ROOT, WORKSPACE_ROOT, BASELINE_DIR);

  app.use(cors({
    origin: appConfig.server.frontendUrl,
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
  app.use('/api/models', modelsRouter());
  app.use('/api/providers', providersRouter());
  app.use('/api/rag', ragRouter());
  app.use('/api/auth', authRouter());
  app.use('/api/lint', lintRouter());
  app.use('/api/git', gitRouter());

  // Workspace routes (require orchestrator)
  if (orchestrator) {
    app.use('/api/workspace', workspaceRouter(orchestrator));
  }

  // Global error handler
  app.use(errorHandlerMiddleware());

  return app;
}