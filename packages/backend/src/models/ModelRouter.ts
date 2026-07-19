import type { BaseModel } from '@agent_design/shared/types';
import { logger } from '../utils/logger';
import { ProviderRegistry } from './ProviderRegistry';
import { ProviderConfigLoader } from '../config/ProviderConfigLoader';
import { ConfigManager } from '../config/ConfigManager';
import { AppError } from '../errors/AppError';
import { ErrorCategory } from '../errors/ErrorTypes';

// --------------------------------------------------------------------------------------------------
// Define interfaces for LLM messages, responses, and streaming callbacks.
// These interfaces provide a consistent structure for how the ModelRouter interacts with different LLM providers.
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}
export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}
export interface StreamCallback {
  onToken: (token: string) => void;
  onComplete: (response: LLMResponse) => void;
  onError: (err: Error) => void;
}

// ModelRouter abstracts interactions with multiple LLM providers via a ProviderRegistry.
// Providers are registered from config/providers.json (merged over built-in defaults) rather
// than being hardcoded here — see ProviderConfigLoader for how that's resolved. ModelRouter
// implements a fallback mechanism to try different models in case the preferred one is
// unavailable or fails.
export class ModelRouter {
  private static instance: ModelRouter | undefined;

  private registry: ProviderRegistry;

  constructor() {
    this.registry = new ProviderRegistry();
    this.initializeProviders();
  }

  // Shared instance used across Orchestrator and the HTTP routes so that provider registry
  // changes (e.g. via the Provider Registry CRUD API) take effect everywhere immediately,
  // without a server restart.
  static getInstance(): ModelRouter {
    if (!ModelRouter.instance) {
      ModelRouter.instance = new ModelRouter();
    }
    return ModelRouter.instance;
  }

  // Re-reads config/providers.json (merged over built-in defaults) and re-registers every
  // provider from scratch. Called after any write through the Provider Registry CRUD API.
  reloadProviders(): void {
    this.registry = new ProviderRegistry();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Higher priority first, so registry iteration order (and therefore /api/models output)
    // reflects config priority without needing to expose it through the LLMProvider interface.
    const configs = ProviderConfigLoader.resolveEffectiveConfigs().sort((a, b) => b.priority - a.priority);
    for (const config of configs) {
      const provider = ProviderConfigLoader.createProvider(config);
      if (provider) {
        this.registry.register(provider, config.modelPrefixes ?? []);
      }
    }
  }

  // Exposes the registry for model listing (e.g. the /api/models routes) and other consumers
  // that need provider metadata without going through ModelRouter's own API surface.
  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  private isModelAvailable(model: string): boolean {
    return this.registry.getProviderForModel(model)?.isAvailable() ?? false;
  }

  // Stream a completion from the preferred model, falling back to other models in the chain if necessary.
  async streamCompletion(
    preferredModel: BaseModel,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    // Build fallback chain starting with preferred model
    const { fallbackChain } = ConfigManager.getInstance().get().llm;
    const chain = [preferredModel, ...fallbackChain.filter((m) => m !== preferredModel)];
    // For each model, try to stream a completion. If it fails, log the error and try the next model in the chain. If all models fail, inform user.
    const attempted: string[] = [];
    for (const model of chain) {
      if (!this.isModelAvailable(model)) {
        logger.info(`Skipping model ${model} — API key not configured`);
        continue;
      }
      attempted.push(model);
      try {
        await this.tryModel(model, systemPrompt, messages, callbacks);
        return;
      } catch (err) {
        logger.warn(`Model ${model} failed, trying next in chain`, {
          error: (err as Error).message,
          category: err instanceof AppError ? err.category : undefined,
        });
      }
    }
    // Inform the user that no completion could be generated. Not retryable here — the fallback
    // chain has already been exhausted, retrying this same call would repeat the same failures.
    const error = new AppError(
      'No models can be used to generate a completion. Please check your API keys and model availability or wait for usage to be available.',
      ErrorCategory.LLM_PROVIDER,
      false,
      'No LLM provider is currently available. Please check your API keys and try again.',
    );
    callbacks.onError(error);
    throw error;
  }

  // Try to stream a completion from a specific model.
  async tryModel(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    const provider = this.registry.getProviderForModel(model);
    if (!provider) {
      throw new AppError(`Unknown model provider for: ${model}`, ErrorCategory.LLM_PROVIDER, false, `Model "${model}" is not recognized by any configured provider.`);
    }
    await provider.streamCompletion(model, systemPrompt, messages, callbacks);
  }

  private async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const provider = this.registry.getProviderForModel(model);
    if (!provider || !provider.generateNonStreaming) {
      throw new AppError(`Unsupported model for generation: ${model}`, ErrorCategory.LLM_PROVIDER, false, `Model "${model}" does not support this operation.`);
    }
    return provider.generateNonStreaming(model, systemPrompt, messages);
  }

  // `customSystemPrompt` lets callers other than the conversation-summary use case (e.g.
  // AI-assisted commit messages) reuse the same free-model fallback chain below without
  // getting wrapped in the default "summarize the conversation" framing.
  async summarize(messages: LLMMessage[], customSystemPrompt?: string): Promise<string> {
    const systemPrompt = customSystemPrompt ?? `You are a summarization assistant. Your task is to summarize the conversation below in a concise, informative paragraph. Focus on key decisions, bugs fixed, design choices, and any conclusions reached. Keep the summary under 200 words.`;
    const userPrompt = customSystemPrompt
      ? messages.map(m => m.content).join('\n')
      : `Summarize the following conversation:\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
    // Free models chain
    const freeModels: string[] = [
      'llama3-70b-8192',   // Groq free tier
      'gemini-3.5-flash',  // Gemini free tier
      'ollama/llama3',     // Local
      'mixtral-8x7b-32768',// Groq free tier
    ];
    // Try every free model to summarize
    for (const model of freeModels) {
      // Skip if model not available (check API key presence for paid ones)
      if (!this.isModelAvailable(model)) continue;
      try {
        const result = await this.generateNonStreaming(model, systemPrompt, [{ role: 'user', content: userPrompt }]);
        if (result.content && result.content.length > 10) {
          logger.info(`Summarization succeeded with ${model}`);
          return result.content;
        }
      } catch (err) {
        logger.warn(`Summarization with ${model} failed: ${err}`);
        continue;
      }
    }
    logger.warn('All summarization models failed.');
    return '';
  }
}
