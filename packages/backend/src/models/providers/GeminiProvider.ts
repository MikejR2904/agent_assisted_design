import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig } from '@agent_design/shared/types';

export class GeminiProvider extends BaseProvider {
  private client: GoogleGenerativeAI;

  constructor(config: ProviderConfig) {
    super(config);
    this.client = new GoogleGenerativeAI(this.apiKey || 'DUMMY_KEY');
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
    const geminiModel = this.client.getGenerativeModel({ model, systemInstruction: systemPrompt });
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const chat = geminiModel.startChat({ history });

    let fullContent = '';
    const result = await chat.sendMessageStream(lastMessage);
    for await (const chunk of result.stream) {
      const text = chunk.text();
      fullContent += text;
      callbacks.onToken(text);
    }
    const response = await result.response;
    const usage = response.usageMetadata;
    callbacks.onComplete({
      content: fullContent,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      model,
    });
  }

  async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const geminiModel = this.client.getGenerativeModel({ model, systemInstruction: systemPrompt });
    const contents = messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
    const result = await geminiModel.generateContent({ contents });
    const content = result.response && typeof result.response.text === 'function' ? result.response.text() : '';
    const usage = result.response?.usageMetadata;
    return {
      content,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    };
  }
}
