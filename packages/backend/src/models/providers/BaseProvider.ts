import type { LLMProvider } from '../LLMProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig, ProviderMetadata } from '@agent_design/shared/types';

// Shared plumbing for provider implementations: config storage, API key resolution from the
// environment variable named in `config.apiKeyEnv`, and default availability/metadata logic.
export abstract class BaseProvider implements LLMProvider {
  public readonly id: string;
  public readonly name: string;
  public readonly type: LLMProvider['type'];
  protected readonly apiKey?: string;

  constructor(protected readonly config: ProviderConfig) {
    this.id = config.id;
    this.name = config.name ?? config.id;
    this.type = config.type;
    // A pasted key (from the Provider Registry UI) takes priority over the env var lookup.
    const pasted = config.apiKeyEncoded ? BaseProvider.decodeKey(config.apiKeyEncoded) : undefined;
    this.apiKey = pasted || (config.apiKeyEnv ? process.env[config.apiKeyEnv] : undefined);
  }

  private static decodeKey(encoded: string): string | undefined {
    try {
      return Buffer.from(encoded, 'base64').toString('utf-8');
    } catch {
      return undefined;
    }
  }

  // Providers that never need a key (e.g. local Ollama) override this. Everything else requires
  // a non-empty resolved key (from either a pasted value or the configured env var).
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getMetadata(): ProviderMetadata {
    const models = this.config.models ?? [];
    return {
      costTier: this.config.costTier,
      models,
      isAvailable: this.isAvailable(),
      lastChecked: new Date().toISOString(),
    };
  }

  abstract getSupportedModels(): string[] | Promise<string[]>;

  abstract streamCompletion(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void>;
}
