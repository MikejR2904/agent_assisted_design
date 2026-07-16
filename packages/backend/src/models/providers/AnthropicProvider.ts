import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig } from '@agent_design/shared/types';

export class AnthropicProvider extends BaseProvider {
  private client: Anthropic;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new Anthropic({ apiKey: this.apiKey || 'DUMMY_KEY' });
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

    const stream = await this.client.messages.stream({
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullContent += event.delta.text;
        callbacks.onToken(event.delta.text);
      }
    }

    const finalMessage = await stream.finalMessage();
    callbacks.onComplete({
      content: fullContent,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      model,
    });
  }

  async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const response = await this.client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const content = response.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join('');
    return { content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}
