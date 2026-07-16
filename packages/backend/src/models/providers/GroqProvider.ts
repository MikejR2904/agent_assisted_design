import Groq from 'groq-sdk';
import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig } from '@agent_design/shared/types';

export class GroqProvider extends BaseProvider {
  private client: Groq;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new Groq({ apiKey: this.apiKey || 'DUMMY_KEY' });
  }

  getSupportedModels(): string[] {
    return this.config.models ?? [];
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
      if ((chunk as any).x_groq?.usage) {
        inputTokens = (chunk as any).x_groq.usage.prompt_tokens;
        outputTokens = (chunk as any).x_groq.usage.completion_tokens;
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
      content: response.choices[0].message?.content || '',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }
}
