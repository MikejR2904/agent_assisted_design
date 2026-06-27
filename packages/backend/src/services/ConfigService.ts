import fs from 'fs/promises';
import path from 'path';
import TOML from 'toml';
import chokidar from 'chokidar';
import { GATE_DEFINITIONS } from '@agent_design/shared';
import type { GateDefinition, AgentConfig } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

export interface ArchitectureConfig {
  module: {
    name: string;
    target_freq_mhz: number;
    data_width: number;
    accum_width: number;
  };
  pins: {
    inputs: string[];
    outputs: string[];
  };
  memory: {
    scratchpad_kb: number;
    max_k: number;
  };
  constraints: {
    max_area_um2: number;
    max_power_mw: number;
  };
}

export class ConfigService {
  private static instance: ConfigService;
  private archConfig: ArchitectureConfig | null = null;
  private watcher: chokidar.FSWatcher | null = null;

  private constructor(
    private readonly configRoot: string,
    private readonly skillsRoot: string,
  ) {}

  static getInstance(configRoot: string, skillsRoot: string): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService(configRoot, skillsRoot);
    }
    return ConfigService.instance;
  }

  async getAgents(): Promise<AgentConfig[]> {
    const data = await fs.readFile(path.join(this.configRoot, 'agents.json'), 'utf-8');
    return JSON.parse(data);
  }

  async init(): Promise<void> {
    await this.loadArchConfig();
    this.watchSkillFiles();
    logger.info('ConfigService initialized', { configRoot: this.configRoot });
  }

  private async loadArchConfig(): Promise<void> {
    const tomlPath = path.join(this.configRoot, 'architecture.toml');
    try {
      const raw = await fs.readFile(tomlPath, 'utf-8');
      this.archConfig = TOML.parse(raw) as ArchitectureConfig;
      logger.info('Loaded architecture.toml');
    } catch (err) {
      logger.error('Failed to load architecture.toml', { err });
      throw err;
    }
  }

  getArchConfig(): ArchitectureConfig {
    if (!this.archConfig) throw new Error('Architecture config not loaded');
    return this.archConfig;
  }

  getGates(): GateDefinition[] {
    return GATE_DEFINITIONS;
  }

  async getSkillContent(agentId: string): Promise<string> {
    const skillPath = path.join(this.skillsRoot, `${agentId}_SKILL.md`);
    try {
      return await fs.readFile(skillPath, 'utf-8');
    } catch {
      logger.warn(`No skill file found for agent ${agentId}, using default`);
      return '# Agent\nYou are an expert RTL design assistant.';
    }
  }

  private watchSkillFiles(): void {
    this.watcher = chokidar.watch(this.skillsRoot, { persistent: false });
    this.watcher.on('change', (filePath) => {
      logger.info('Skill file changed, hot-reloading', { filePath });
      // Agents pick up the new content on next call to getSkillContent()
    });
  }

  async destroy(): Promise<void> {
    await this.watcher?.close();
  }
}