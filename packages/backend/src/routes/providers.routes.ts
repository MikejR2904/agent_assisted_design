import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { ProviderConfigSchema, ProvidersFileSchema } from '@agent_design/shared/types';
import type { ProviderConfig } from '@agent_design/shared/types';
import { ModelRouter } from '../models/ModelRouter';
import { DEFAULT_PROVIDER_CONFIGS } from '../config/ProviderConfigLoader';
import { logger } from '../utils/logger';

const PROVIDERS_FILE = path.resolve(process.cwd(), '../../config/providers.json');
const DEFAULT_IDS = DEFAULT_PROVIDER_CONFIGS.map((c) => c.id);

// Request body accepts a plaintext `apiKey` instead of the stored `apiKeyEncoded` field — the
// route encodes it server-side so callers never have to base64 it themselves, and GET responses
// never echo key material back out.
const ProviderInputSchema = ProviderConfigSchema.omit({ apiKeyEncoded: true }).extend({
  apiKey: z.string().optional(),
});

async function loadProvidersFile(): Promise<ProviderConfig[]> {
  try {
    const raw = await fs.readFile(PROVIDERS_FILE, 'utf-8');
    const parsed = ProvidersFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.providers : [];
  } catch {
    return [];
  }
}

async function saveProvidersFile(providers: ProviderConfig[]): Promise<void> {
  await fs.mkdir(path.dirname(PROVIDERS_FILE), { recursive: true });
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify({ providers }, null, 2), 'utf-8');
  logger.info('Providers config saved', { count: providers.length });
}

function sanitize(config: ProviderConfig): Omit<ProviderConfig, 'apiKeyEncoded'> {
  const { apiKeyEncoded: _key, ...rest } = config;
  return rest;
}

function encodeKey(key: string): string {
  return Buffer.from(key, 'utf-8').toString('base64');
}

export function providersRouter(): Router {
  const router = Router();

  // GET /api/providers
  router.get('/', async (_req, res) => {
    try {
      const custom = await loadProvidersFile();
      const effective = ModelRouter.getInstance().getRegistry().getProviderStatuses();
      // `defaults` carries the full routing config for built-ins that have no override yet
      // (baseURL, models, priority, ...) so the edit form can prefill them — `effective` alone
      // (ProviderStatus) is too thin for that.
      res.json({
        effective,
        custom: custom.map(sanitize),
        defaults: DEFAULT_PROVIDER_CONFIGS.map(sanitize),
        defaultIds: DEFAULT_IDS,
      });
    } catch (err) {
      logger.error('Failed to load providers', { error: (err as Error).message });
      res.status(500).json({ error: 'Failed to load providers' });
    }
  });

  // POST /api/providers — create a new (custom) provider
  router.post('/', async (req, res) => {
    const parsed = ProviderInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const { apiKey, ...configFields } = parsed.data;
    const custom = await loadProvidersFile();
    if (custom.some((c) => c.id === configFields.id) || DEFAULT_IDS.includes(configFields.id)) {
      return res.status(409).json({ error: `Provider id '${configFields.id}' already exists` });
    }

    const newConfig = ProviderConfigSchema.parse({
      ...configFields,
      apiKeyEncoded: apiKey ? encodeKey(apiKey) : undefined,
    });

    custom.push(newConfig);
    await saveProvidersFile(custom);
    ModelRouter.getInstance().reloadProviders();
    logger.info('Provider created', { providerId: newConfig.id });

    res.status(201).json({
      effective: ModelRouter.getInstance().getRegistry().getProviderStatuses(),
      custom: custom.map(sanitize),
    });
  });

  // PUT /api/providers/:id — update a custom provider, or persist an override for a built-in one
  router.put('/:id', async (req, res) => {
    const parsed = ProviderInputSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

    const custom = await loadProvidersFile();
    const existingCustom = custom.find((c) => c.id === req.params.id);
    const base = existingCustom ?? DEFAULT_PROVIDER_CONFIGS.find((c) => c.id === req.params.id);
    if (!base) return res.status(404).json({ error: 'Provider not found' });

    const { apiKey, ...configFields } = parsed.data;
    const merged = ProviderConfigSchema.parse({
      ...base,
      ...configFields,
      id: req.params.id,
      apiKeyEncoded: apiKey ? encodeKey(apiKey) : base.apiKeyEncoded,
    });

    const idx = custom.findIndex((c) => c.id === req.params.id);
    if (idx === -1) custom.push(merged); else custom[idx] = merged;
    await saveProvidersFile(custom);
    ModelRouter.getInstance().reloadProviders();
    logger.info('Provider updated', { providerId: merged.id });

    res.json({
      effective: ModelRouter.getInstance().getRegistry().getProviderStatuses(),
      custom: custom.map(sanitize),
    });
  });

  // DELETE /api/providers/:id — only for custom providers; built-ins must be disabled instead
  router.delete('/:id', async (req, res) => {
    if (DEFAULT_IDS.includes(req.params.id)) {
      return res.status(400).json({
        error: `Built-in provider '${req.params.id}' can't be deleted — disable it instead (PUT with { "enabled": false }).`,
      });
    }

    const custom = await loadProvidersFile();
    const filtered = custom.filter((c) => c.id !== req.params.id);
    if (filtered.length === custom.length) return res.status(404).json({ error: 'Provider not found' });

    await saveProvidersFile(filtered);
    ModelRouter.getInstance().reloadProviders();
    logger.info('Provider deleted', { providerId: req.params.id });

    res.json({
      effective: ModelRouter.getInstance().getRegistry().getProviderStatuses(),
      custom: filtered.map(sanitize),
    });
  });

  return router;
}
