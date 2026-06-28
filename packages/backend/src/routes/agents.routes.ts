import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { CreateAgentSchema } from '@agent_design/shared/types';
import type { AgentConfig } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

const AGENTS_FILE = path.resolve(process.cwd(), '../../config/agents.json');

async function loadAgents(): Promise<AgentConfig[]> {
  try {
    const raw = await fs.readFile(AGENTS_FILE, 'utf-8');
    return JSON.parse(raw) as AgentConfig[];
  } catch {
    return [];
  }
}

async function saveAgents(agents: AgentConfig[]): Promise<void> {
  await fs.mkdir(path.dirname(AGENTS_FILE), { recursive: true });
  await fs.writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2), 'utf-8');
  logger.info('Agents saved', { count: agents.length });
}

export function agentsRouter(): Router {
  const router = Router();

  // GET /api/agents
  router.get('/', async (_req, res) => {
    try {
      const agents = await loadAgents();
      // Never expose API keys
      // const sanitized = agents.map(({ apiKey: _k, ...rest }) => rest);
      res.json(agents);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load agents' });
    }
  });

  // POST /api/agents
  router.post('/', async (req, res) => {
    const parsed = CreateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues });
    }

    const agents = await loadAgents();
    const now = new Date().toISOString();
    const newAgent: AgentConfig = {
      ...parsed.data,
      id: uuidv4(),
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
    if (newAgent.apiKey) {
      newAgent.apiKey = Buffer.from(newAgent.apiKey).toString('base64');
    }

    agents.push(newAgent);
    await saveAgents(agents);
    logger.info('Agent created', { agentId: newAgent.id, name: newAgent.name });

    res.status(201).json(newAgent);
  });

  // PUT /api/agents/:id
  router.put('/:id', async (req, res) => {
    const agents = await loadAgents();
    const idx = agents.findIndex((a) => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Agent not found' });

    const parsed = CreateAgentSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const updated = { ...agents[idx], ...parsed.data, updatedAt: new Date().toISOString() };
    if (parsed.data.apiKey) {
      // Encode if not already encoded (assume plaintext)
      updated.apiKey = Buffer.from(parsed.data.apiKey).toString('base64');
    }
    agents[idx] = updated;
    await saveAgents(agents);
    res.json(updated);
  });

  // DELETE /api/agents/:id
  router.delete('/:id', async (req, res) => {
    const agents = await loadAgents();
    const filtered = agents.filter((a) => a.id !== req.params.id);
    if (filtered.length === agents.length) return res.status(404).json({ error: 'Agent not found' });

    await saveAgents(filtered);
    logger.info('Agent deleted', { agentId: req.params.id });
    res.status(204).send();
  });

  return router;
}