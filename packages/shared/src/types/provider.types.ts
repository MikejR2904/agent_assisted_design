import { z } from 'zod';

// -------------------------------------------------------------------------------------------------
// LLM router provider configuration. Entries in config/providers.json are validated against this
// schema and merged (by `id`) on top of the router's built-in default providers.

export const ProviderTypeSchema = z.enum([
  'openai-compatible',
  'anthropic',
  'gemini',
  'groq',
  'ollama',
  'custom',
]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

export const CostTierSchema = z.enum(['free', 'low', 'medium', 'high', 'premium', 'mixed']);
export type CostTier = z.infer<typeof CostTierSchema>;

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  type: ProviderTypeSchema,
  apiKeyEnv: z.string().optional(),
  // Base64-encoded API key pasted through the Provider Registry UI. Preferred over apiKeyEnv
  // when both are present. Never echoed back by the providers API once stored.
  apiKeyEncoded: z.string().optional(),
  baseURL: z.string().url().optional(),
  defaultHeaders: z.record(z.string()).optional(),
  costTier: CostTierSchema.default('medium'),
  priority: z.number().int().min(0).default(0),
  models: z.array(z.string()).optional(),
  // Prefix hints (e.g. 'claude-', 'gpt-') used to route unlisted/versioned model IDs to a
  // provider without requiring an exhaustive `models` list. Native providers rely on this;
  // OpenAI-compatible providers with a fetched/explicit `models` list generally don't need it.
  modelPrefixes: z.array(z.string()).optional(),
  config: z.record(z.any()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProvidersFileSchema = z.object({
  providers: z.array(ProviderConfigSchema),
});
export type ProvidersFile = z.infer<typeof ProvidersFileSchema>;

// Runtime metadata reported by a live provider instance.
export interface ProviderMetadata {
  costTier: CostTier;
  avgLatencyMs?: number;
  models: string[];
  isAvailable: boolean;
  lastChecked: string;
}

// Summary shape returned by GET /api/models/providers.
export const ProviderStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: ProviderTypeSchema,
  available: z.boolean(),
  costTier: CostTierSchema,
  modelCount: z.number().int().min(0),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
