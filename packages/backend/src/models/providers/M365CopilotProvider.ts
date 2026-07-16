import { BaseProvider } from './BaseProvider';
import type { LLMMessage, StreamCallback } from '../ModelRouter';
import type { ProviderConfig } from '@agent_design/shared/types';
import { FetchRequestAdapter } from '@microsoft/kiota-http-fetchlibrary';
import { ApiKeyAuthenticationProvider, ApiKeyLocation } from '@microsoft/kiota-abstractions';
const { createBaseAgentsM365CopilotServiceClient } = require('@microsoft/agents-m365copilot') as any;

// Microsoft 365 Copilot provider. Only instantiable for the built-in 'm365copilot' default
// config — 'custom' type providers are otherwise not dynamically loadable from providers.json,
// since this client requires the Kiota adapter setup rather than a generic REST shape.
export class M365CopilotProvider extends BaseProvider {
  private client: ReturnType<typeof createBaseAgentsM365CopilotServiceClient>;

  constructor(config: ProviderConfig) {
    super(config);
    const authProvider = new ApiKeyAuthenticationProvider(
      this.apiKey || 'DUMMY_KEY',
      'Authorization',
      ApiKeyLocation.Header,
    );
    const adapter = new FetchRequestAdapter(authProvider);
    adapter.baseUrl = config.baseURL ?? process.env.M365COPILOT_BASE_URL ?? 'https://api.m365copilotagents.microsoft.com';
    this.client = createBaseAgentsM365CopilotServiceClient(adapter);
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
    const response = await this.client.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ],
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of response) {
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
}
