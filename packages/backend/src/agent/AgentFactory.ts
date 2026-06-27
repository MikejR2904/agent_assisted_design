import type { AgentConfig } from '@agent_design/shared/types';
import { Agent } from './Agent';
import { ModelRouter } from '../models/ModelRouter';
import { ConfigService } from '../services/ConfigService';
import { TelemetryService } from '../services/TelemetryService';
import { FileService } from '../tools/FileService';
import { Sandbox } from '../tools/Sandbox';
import { ToolExecutor } from '../tools/ToolExecutor';
import { logger } from '../utils/logger';
import path from 'path';

export class AgentFactory {
  constructor(
    private readonly modelRouter: ModelRouter,
    private readonly configService: ConfigService,
    private readonly telemetryService: TelemetryService,
  ) {}

  build(config: AgentConfig, workspaceDir: string): Agent {
    // Determine actual workspace root
    const agentWorkspace = config.scope?.workspaceRoot 
      ? path.join(workspaceDir, config.scope.workspaceRoot)
      : workspaceDir;
    const fileService = new FileService(
      agentWorkspace,
      config.scope?.allowedPaths,
    );
    const sandbox = new Sandbox(workspaceDir);
    const toolExecutor = new ToolExecutor(fileService, sandbox);

    logger.info('Building agent', { agentId: config.id, name: config.name, model: config.baseModel });

    return new Agent(
      config,
      this.modelRouter,
      this.configService,
      this.telemetryService,
      toolExecutor,
    );
  }
}