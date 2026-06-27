import { Router } from 'express';
import { Orchestrator } from '../orchestrator/Orchestrator';
import type { AgentConfig } from '@agent_design/shared/types';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ConfigService } from '../services/ConfigService';
import { logger } from '../utils/logger';

const AGENTS_FILE = path.resolve(process.cwd(), '../../config/agents.json');

export async function loadAgentsFromConfig(): Promise<AgentConfig[]> {
  try {
    const raw = await fs.readFile(AGENTS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data;
    } else if (data.agents && Array.isArray(data.agents)) {
      return data.agents;
    } else {
      logger.warn('agents.json has unexpected format, expected array or { agents: [...] }');
      return [];
    }
  } catch (err) {
    logger.error('Failed to load agents.json', { err });
    return [];
  }
}

export function workspaceRouter(orchestrator: Orchestrator): Router {
  const router = Router();
  // POST /api/workspace/init
  // Body: { condition: 'manual'|'nhil'|'hitl'|'agent-assisted', agentIds?: string[] }
  router.post('/init', async (req, res) => {
    try {
      const { condition, agentIds } = req.body;
      if (!condition) {
        return res.status(400).json({ error: 'condition is required' });
      }
      const validConditions = ['manual', 'nhil', 'hitl', 'agent-assisted'];
      if (!validConditions.includes(condition)) {
        return res.status(400).json({ error: `Invalid condition: ${condition}` });
      }
      // Load all agents from config
      const allAgents = await loadAgentsFromConfig();
      // Filter by agentIds if provided, else use all active agents
      let selectedAgents = allAgents;
      if (agentIds && Array.isArray(agentIds) && agentIds.length > 0) {
        selectedAgents = allAgents.filter(a => agentIds.includes(a.id));
        if (selectedAgents.length === 0) {
          return res.status(400).json({ error: 'No matching agents found for given IDs' });
        }
      } else {
        // Use all agents that are not in error state
        selectedAgents = allAgents.filter(a => a.status !== 'error');
      }
      // Initiate session with the orchestrator
      const sessionId = await orchestrator.initSession(condition as any, selectedAgents);
      res.json({ sessionId, condition, agentCount: selectedAgents.length });
    } catch (err) {
      logger.error('Workspace init error', { err: (err as Error).message });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}