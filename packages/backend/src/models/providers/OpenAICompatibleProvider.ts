import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig, ProviderMetadata } from '@agent_design/shared/types';
import { logger } from '../../utils/logger';

// Generic OpenAI-compatible provider: talks to any endpoint implementing the OpenAI chat
// completions API (OpenRouter, Fireworks, Together, vLLM, DeepSeek, Grok, and OpenAI itself).
export class OpenAICompatibleProvider extends BaseProvider {
  private client: OpenAI;
  private fetchedModels: string[] | null = null;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: this.apiKey || 'dummy',
      baseURL: config.baseURL,
      defaultHeaders: config.defaultHeaders,
    });
  }

  getMetadata(): ProviderMetadata {
    const base = super.getMetadata();
    if (!base.models.length && this.fetchedModels) {
      return { ...base, models: this.fetchedModels };
    }
    return base;
  }

  async getSupportedModels(): Promise<string[]> {
    if (this.config.models?.length) return this.config.models;
    if (this.fetchedModels) return this.fetchedModels;
    try {
      const response = await this.client.models.list();
      this.fetchedModels = response.data.map((m) => m.id);
      return this.fetchedModels;
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
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await this.client.chat.completions.create({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        callbacks.onToken(delta);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    callbacks.onComplete({ content: fullContent, inputTokens, outputTokens, model });
  }

  async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return {
      content: response.choices[0]?.message?.content || '',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }
}
