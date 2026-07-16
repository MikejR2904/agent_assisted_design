import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig } from '@agent_design/shared/types';
import { logger } from '../../utils/logger';

// Local Ollama provider. Model IDs are passed without the 'ollama/' prefix that ModelRouter
// strips before delegating (the prefix is only used for routing, matching prior behavior).
export class OllamaProvider extends BaseProvider {
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseURL ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  }

  isAvailable(): boolean {
    return true;
  }

  async getSupportedModels(): Promise<string[]> {
    if (this.config.models?.length) return this.config.models;
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json();
      return (data.models ?? []).map((m: { name: string }) => m.name);
    } catch (err) {
      logger.warn(`Failed to fetch models for provider ${this.id}`, { error: (err as Error).message });
      return [];
    }
  }

  async streamCompletion(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    const ollamaModel = model.replace(/^ollama\//, '');
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }

    let fullContent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n').filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            const token = parsed.message?.content ?? '';
            if (token) {
              fullContent += token;
              callbacks.onToken(token);
            }
          } catch {
            // Ignore parse errors on partial/heartbeat lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete({ content: fullContent, inputTokens: 0, outputTokens: 0, model: ollamaModel });
  }

  async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.replace(/^ollama\//, ''),
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
    const data = await response.json();
    return { content: data.message?.content || '', inputTokens: 0, outputTokens: 0 };
  }
}
