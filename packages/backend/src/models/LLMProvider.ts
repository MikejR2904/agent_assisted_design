import type { LLMMessage, StreamCallback } from './ModelRouter';
import type { ProviderMetadata } from '@agent_design/shared/types';

// Standard interface every router provider (built-in or config-driven) must implement.
// ModelRouter and ProviderRegistry only ever depend on this interface — never on a concrete
// SDK client — so new providers are added by registering an implementation, not by editing
// ModelRouter.ts.
export interface LLMProvider {
  id: string;
  name: string;
  type: 'openai-compatible' | 'anthropic' | 'gemini' | 'groq' | 'ollama' | 'custom';

  isAvailable(): boolean;

  getSupportedModels(): string[] | Promise<string[]>;

  streamCompletion(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void>;

  generateNonStreaming?(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }>;

  getMetadata(): ProviderMetadata;
}
