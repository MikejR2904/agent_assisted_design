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

const PORT = parseInt(process.env.PORT ?? '5000', 10);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? path.resolve(__dirname, '../../../workspaces');
const BASELINE_DIR = path.join(WORKSPACE_ROOT, 'baseline_stub');
const CONFIG_ROOT = process.env.CONFIG_ROOT ?? path.resolve(__dirname, '../../../config');
const SKILLS_ROOT = process.env.SKILLS_ROOT ?? path.resolve(__dirname, '../../../skills');
const TELEMETRY_ROOT = process.env.TELEMETRY_ROOT ?? path.resolve(__dirname, '../../../telemetry');

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

  // Create WebSocket server + orchestrator
  // We create a temporary io reference to satisfy circular dependency
  const { Server: SocketIO } = await import('socket.io');
  const io = new SocketIO(httpServer, {
    cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' },
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

  // Create the Express app with orchestrator and attach WebSocket handlers
  const app = createApp(orchestrator);
  httpServer.on('request', app);
  createWebSocketServer(httpServer, orchestrator);
  createTerminalServer(httpServer);

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