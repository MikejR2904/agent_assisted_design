import fs from 'fs';
import path from 'path';
import type { LLMProvider } from '../models/LLMProvider';
import { OpenAICompatibleProvider } from '../models/providers/OpenAICompatibleProvider';
import { AnthropicProvider } from '../models/providers/AnthropicProvider';
import { GeminiProvider } from '../models/providers/GeminiProvider';
import { GroqProvider } from '../models/providers/GroqProvider';
import { OllamaProvider } from '../models/providers/OllamaProvider';
import { M365CopilotProvider } from '../models/providers/M365CopilotProvider';
import { ProvidersFileSchema, ProviderConfigSchema } from '@agent_design/shared/types';
import type { ProviderConfig } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

const CONFIG_PATH = path.resolve(process.cwd(), '../../config/providers.json');

// Built-in providers, reconstructed as configs. These always register first as the base layer;
// config/providers.json (if present) is merged on top, overriding entries with a matching `id`
// and adding any new ones. modelPrefixes preserve the current prefix-based routing behavior
// (e.g. 'claude-' -> anthropic) so versioned/unlisted model IDs keep resolving without an
// exhaustive `models` list.
export const DEFAULT_PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'anthropic', enabled: true, type: 'anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY',
    costTier: 'high', priority: 10, modelPrefixes: ['claude-'],
    models: ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229', 'claude-opus-4.8', 'claude-sonnet-4.5'],
  },
  {
    id: 'openai', enabled: true, type: 'openai-compatible', apiKeyEnv: 'OPENAI_API_KEY',
    costTier: 'high', priority: 9, modelPrefixes: ['gpt-'],
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'deepseek', enabled: true, type: 'openai-compatible', apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com', costTier: 'low', priority: 6, modelPrefixes: ['deepseek-'],
    models: ['deepseek-coder', 'deepseek-chat'],
  },
  {
    id: 'grok', enabled: true, type: 'openai-compatible', apiKeyEnv: 'GROK_API_KEY',
    baseURL: 'https://api.x.ai/v1', costTier: 'medium', priority: 6, modelPrefixes: ['grok-'],
    models: ['grok-1', 'grok-beta'],
  },
  {
    id: 'gemini', enabled: true, type: 'gemini', apiKeyEnv: 'GEMINI_API_KEY',
    costTier: 'medium', priority: 8, modelPrefixes: ['gemini-'],
    models: ['gemini-3.1-pro', 'gemini-3.5-flash', 'gemini-3.1-ultra'],
  },
  {
    id: 'groq', enabled: true, type: 'groq', apiKeyEnv: 'GROQ_API_KEY',
    costTier: 'free', priority: 7, modelPrefixes: ['llama', 'mixtral'],
    models: ['llama3-70b-8192', 'mixtral-8x7b-32768'],
  },
  {
    id: 'ollama', enabled: true, type: 'ollama',
    costTier: 'free', priority: 1, modelPrefixes: ['ollama/'],
    models: ['ollama/llama3', 'ollama/codellama'],
  },
  {
    id: 'm365copilot', enabled: true, type: 'custom', apiKeyEnv: 'M365COPILOT_API_KEY',
    costTier: 'premium', priority: 5, modelPrefixes: ['copilot'],
    models: ['copilot'],
  },
].map((c) => ProviderConfigSchema.parse(c));

export class ProviderConfigLoader {
  // Synchronous by design: ModelRouter's constructor registers providers immediately so
  // streamCompletion can be called right after `new ModelRouter()`, exactly as before.
  static load(): ProviderConfig[] {
    let raw: string;
    try {
      raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    } catch {
      logger.info('No config/providers.json found — using built-in default providers only.');
      return [];
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (err) {
      logger.warn('Failed to parse config/providers.json — ignoring it.', { error: (err as Error).message });
      return [];
    }

    const result = ProvidersFileSchema.safeParse(parsedJson);
    if (!result.success) {
      logger.warn('config/providers.json failed validation — ignoring it.', { issues: result.error.issues });
      return [];
    }

    return result.data.providers;
  }

  // Merges built-in defaults with config/providers.json by id (file entries override a default
  // with the same id; new ids are additive), then drops disabled entries.
  static resolveEffectiveConfigs(): ProviderConfig[] {
    const merged = new Map<string, ProviderConfig>();
    for (const config of DEFAULT_PROVIDER_CONFIGS) merged.set(config.id, config);
    for (const config of ProviderConfigLoader.load()) merged.set(config.id, config);
    return Array.from(merged.values()).filter((c) => c.enabled !== false);
  }

  static createProvider(config: ProviderConfig): LLMProvider | null {
    try {
      switch (config.type) {
        case 'anthropic':
          return new AnthropicProvider(config);
        case 'gemini':
          return new GeminiProvider(config);
        case 'groq':
          return new GroqProvider(config);
        case 'ollama':
          return new OllamaProvider(config);
        case 'openai-compatible':
          return new OpenAICompatibleProvider(config);
        case 'custom':
          if (config.id === 'm365copilot') return new M365CopilotProvider(config);
          logger.warn(`Unsupported custom provider id '${config.id}' — 'custom' is reserved for built-in providers.`);
          return null;
        default:
          logger.warn(`Unknown provider type for '${config.id}': ${config.type}`);
          return null;
      }
    } catch (err) {
      logger.error(`Failed to instantiate provider '${config.id}'`, { error: (err as Error).message });
      return null;
    }
  }
}
