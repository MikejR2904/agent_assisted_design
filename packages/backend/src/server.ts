import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { createApp } from './app';
import { createWebSocketServer } from './websocket/WebSocketServer';
import { createTerminalServer } from './websocket/TerminalServer';
import { Orchestrator } from './orchestrator/Orchestrator';
import { ConfigService } from './services/ConfigService';
import { TelemetryService } from './services/TelemetryService';
import { SessionService } from './services/SessionService';
import { ProjectService } from './services/ProjectService';
import { logger } from './utils/logger';
import { ConfigManager } from './config/ConfigManager';
import { startConfigHotReload } from './config/hotReload';

const appConfig = ConfigManager.getInstance().get();
const PORT = appConfig.server.port;
const WORKSPACE_ROOT = appConfig.paths.workspaceRoot!;
const BASELINE_DIR = path.join(WORKSPACE_ROOT, 'baseline_stub');
const CONFIG_ROOT = appConfig.paths.configRoot!;
const SKILLS_ROOT = appConfig.paths.skillsRoot!;
const TELEMETRY_ROOT = appConfig.paths.telemetryRoot!;

function preloadAgentsConfig(): void {
  try {
    // Explicitly load the .env relative to this server file's position to avoid process.cwd() bugs
    const envPath = path.resolve(__dirname, '../../.env');
    dotenv.config({ path: envPath });
    const configPath = path.join(CONFIG_ROOT, 'agents.json');
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const agents = JSON.parse(fileContent);
      if (Array.isArray(agents)) {
        logger.info(`Parsing ${configPath} array for agent-specific API keys...`);
        for (const agent of agents) {
          if (agent.apiKey && agent.apiKey.trim() !== '' && agent.apiKey !== 'DUMMY_KEY') {
            let decodedKey = agent.apiKey;
            try {
              decodedKey = Buffer.from(agent.apiKey, 'base64').toString('utf-8');
            } catch {
              // If not valid base64, keep as is
            }
            const model: string = agent.baseModel ?? '';
            let targetEnvKey = '';
            // Map the agent's baseModel selection back to its systemic environment variable
            if (model.startsWith('gemini-')) targetEnvKey = 'GEMINI_API_KEY';
            else if (model.startsWith('claude-')) targetEnvKey = 'ANTHROPIC_API_KEY';
            else if (model.startsWith('gpt-')) targetEnvKey = 'OPENAI_API_KEY';
            else if (model.startsWith('deepseek-')) targetEnvKey = 'DEEPSEEK_API_KEY';
            else if (model.startsWith('grok-')) targetEnvKey = 'GROK_API_KEY';
            else if (model.startsWith('llama') || model.startsWith('mixtral')) targetEnvKey = 'GROQ_API_KEY';
            if (targetEnvKey) {
              // Override if current process.env is missing or a dummy
              if (!process.env[targetEnvKey] || process.env[targetEnvKey] === 'DUMMY_KEY') {
                process.env[targetEnvKey] = decodedKey;
                logger.info(`Mapped agent key for [${agent.name}] directly into process.env.${targetEnvKey}`);
              }
            }
          }
        }
      }
    } else {
      logger.warn(`No agents.json config found at ${configPath}.`);
    }
  } catch (err) {
    logger.error('Failed to pre-flight sync config/agents.json schema arrays.', {
      error: (err as Error).message,
    });
  }
}

async function main(): Promise<void> {
  preloadAgentsConfig();
  // Initialize services
  const configService = ConfigService.getInstance(CONFIG_ROOT, SKILLS_ROOT);
  await configService.init();
  const telemetryService = TelemetryService.getInstance(TELEMETRY_ROOT);
  const sessionService = new SessionService(TELEMETRY_ROOT);
  const projectService = new ProjectService(TELEMETRY_ROOT, WORKSPACE_ROOT, BASELINE_DIR);

  // Create HTTP server
  const httpServer = http.createServer();

  // Single Socket.IO server instance, shared between Orchestrator (which broadcasts via
  // `this.io.emit(...)`) and createWebSocketServer (which handles real client connections) — see
  // the comment on createWebSocketServer for why these must not be two separate instances.
  const { Server: SocketIO } = await import('socket.io');
  const io = new SocketIO(httpServer, {
    cors: { origin: appConfig.server.frontendUrl, methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const orchestrator = new Orchestrator(
    io,
    configService,
    telemetryService,
    sessionService,
    projectService,
    WORKSPACE_ROOT,
    BASELINE_DIR,
  );

  // Create the Express app with orchestrator and attach WebSocket handlers.
  // Socket.IO's `new SocketIO(httpServer, ...)` above already registered its own internal
  // 'request' listener on this same httpServer for its own path (default '/socket.io/'). Node's
  // http.Server invokes every registered 'request' listener for every request — it doesn't stop
  // at the first one that responds — so if Express were also wired to handle every request
  // unconditionally, it would run a second time on top of a response Socket.IO already sent for
  // its own paths, corrupting it. Skip Express entirely for Socket.IO's own path prefix.
  const app = createApp(orchestrator);
  const socketIoPath = '/socket.io/';
  httpServer.on('request', (req, res) => {
    if (req.url?.startsWith(socketIoPath)) return;
    app(req, res);
  });
  createWebSocketServer(io, orchestrator);
  createTerminalServer(httpServer);
  const configWatcher = startConfigHotReload();

  httpServer.listen(PORT, () => {
    logger.info(`🚀 Backend running on http://localhost:${PORT}`);
    logger.info(`   Workspace root: ${WORKSPACE_ROOT}`);
    logger.info(`   Config root:    ${CONFIG_ROOT}`);
    logger.info(`   Skills root:    ${SKILLS_ROOT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await configService.destroy();
    await configWatcher.close();
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    logger.error("Fatal startup error", { message: err.message, stack: err.stack });
  } else {
    logger.error("Fatal startup error", { err });
  }
  process.exit(1);
});