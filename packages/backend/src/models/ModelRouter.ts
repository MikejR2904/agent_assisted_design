// Import AI model SDKs and necessary types
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai'; //  Gemini API client
import Groq from 'groq-sdk';
const { createBaseAgentsM365CopilotServiceClient } = require('@microsoft/agents-m365copilot') as any;
import { FetchRequestAdapter } from "@microsoft/kiota-http-fetchlibrary";
import { ApiKeyAuthenticationProvider, ApiKeyLocation  } from "@microsoft/kiota-abstractions";

import path from 'path';
import fs from 'fs';

// Import shared fallback chain models
import { MODEL_FALLBACK_CHAIN } from '@agent_design/shared';
import type { BaseModel } from '@agent_design/shared/types';
import { logger } from '../utils/logger';
 
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
 
// ModelRouter class that abstracts interactions with multiple LLM providers. It implements a fallback mechanism to try different models in case the preferred one is unavailable or fails. 
// Each provider has its own method for streaming completions, but the ModelRouter provides a unified interface for the rest of the system to use.
export class ModelRouter {
  private anthropic: Anthropic;
  private openai: OpenAI;
  private deepseek: OpenAI;
  private grok: OpenAI;
  private gemini: GoogleGenerativeAI;
  private groq: Groq;
  private m365Copilot: ReturnType<typeof createBaseAgentsM365CopilotServiceClient>;

  // Internal cache for config file values
  private agentsConfig: Record<string, string> = {};

  constructor() {
    this.loadAgentsConfig();
    this.anthropic = new Anthropic({ apiKey: this.getKey('ANTHROPIC_API_KEY') });
    this.openai = new OpenAI({ apiKey: this.getKey('OPENAI_API_KEY') });
    this.deepseek = new OpenAI({
      apiKey: this.getKey('DEEPSEEK_API_KEY'),
      baseURL: 'https://api.deepseek.com',
    });
    this.grok = new OpenAI({
      apiKey: this.getKey('GROK_API_KEY'),
      baseURL: 'https://api.x.ai/v1',  // Official xAI OpenAI-compatible endpoint
    });
    this.gemini = new GoogleGenerativeAI(this.getKey('GEMINI_API_KEY'));
    this.groq = new Groq({ apiKey: this.getKey('GROQ_API_KEY') });

    const authProvider = new ApiKeyAuthenticationProvider(
      this.getKey('M365COPILOT_API_KEY'),
      "Authorization", // header name
      ApiKeyLocation.Header // location: use header,
    );
    const adapter = new FetchRequestAdapter(authProvider);
    adapter.baseUrl = process.env.M365COPILOT_BASE_URL ?? "https://api.m365copilotagents.microsoft.com";
    this.m365Copilot = createBaseAgentsM365CopilotServiceClient(adapter);

    const keys = {
      ANTHROPIC_API_KEY: this.getKey('ANTHROPIC_API_KEY'),
      OPENAI_API_KEY: this.getKey('OPENAI_API_KEY'),
      DEEPSEEK_API_KEY: this.getKey('DEEPSEEK_API_KEY'),
      GROK_API_KEY: this.getKey('GROK_API_KEY'),
      GEMINI_API_KEY: this.getKey('GEMINI_API_KEY'),
      GROQ_API_KEY: this.getKey('GROQ_API_KEY'),
      M365COPILOT_API_KEY: this.getKey('M365COPILOT_API_KEY'),
    };
    console.log("Loaded API keys:", keys);
  }

  private loadAgentsConfig() {
    try {
      const configPath = path.resolve(process.cwd(), 'config', 'agents.json');
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        this.agentsConfig = JSON.parse(fileContent);
      }
    } catch (err) {
      logger.warn('Failed to parse config/agents.json, relying entirely on environment variables.', {
        error: (err as Error).message,
      });
    }
  }

  private getKey(keyName: string, fallbackDefault = 'DUMMY_KEY'): string {
    const envVal = process.env[keyName];
    if (envVal && envVal !== 'DUMMY_KEY') {
      return envVal;
    }

    const jsonVal = this.agentsConfig[keyName];
    if (jsonVal && jsonVal !== 'DUMMY_KEY') {
      return jsonVal;
    }

    return fallbackDefault;
  }
  
  private isModelAvailable(model: string): boolean {
    const hasValidKey = (keyName: string) => {
      const val = this.getKey(keyName);
      return !!val && val !== 'DUMMY_KEY';
    };
    if (model.startsWith('claude-')) return hasValidKey('ANTHROPIC_API_KEY');
    if (model.startsWith('gpt-')) return hasValidKey('OPENAI_API_KEY');
    if (model.startsWith('gemini-')) return hasValidKey('GEMINI_API_KEY');
    if (model.startsWith('copilot')) return hasValidKey('M365COPILOT_API_KEY');
    if (model.startsWith('deepseek-')) return hasValidKey('DEEPSEEK_API_KEY');
    if (model.startsWith('grok-')) return hasValidKey('GROK_API_KEY');
    // Groq models (llama, mixtral, gemma, etc.) hosted via the Groq API
    if (model.startsWith('llama') || model.startsWith('mixtral')) {
      return hasValidKey('GROQ_API_KEY');
    }
    // Ollama is local, always consider available (will fail at runtime if not running)
    return true;
  }

  // Stream a completion from the preferred model, falling back to other models in the chain if necessary.
  async streamCompletion(
    preferredModel: BaseModel,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    // Build fallback chain starting with preferred model
    const chain = [preferredModel, ...MODEL_FALLBACK_CHAIN.filter((m) => m !== preferredModel)];
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
        });
      }
    }
    // Inform the user that no completion could be generated.
    callbacks.onError(new Error('No models can be used to generate a completion. Please check your API keys and model availability or wait for usage to be available.'));
  }
 
  // Try to stream a completion from a specific model.
  private async tryModel(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    if (model.startsWith('claude-')) {
      await this.streamAnthropic(model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('gpt-')) {
      await this.streamOpenAI(this.openai, model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('gemini-')) {
      await this.streamGemini(model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('copilot')) {
      await this.streamM365Copilot(model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('grok-')) {
      await this.streamOpenAI(this.grok, model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('deepseek-')) {
      await this.streamOpenAI(this.deepseek, model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('llama') || model.startsWith('mixtral')) {
      await this.streamGroq(model, systemPrompt, messages, callbacks);
    } else if (model.startsWith('ollama/')) {
      await this.streamOllama(model.replace('ollama/', ''), systemPrompt, messages, callbacks);
    } else {
      throw new Error(`Unknown model provider for: ${model}`);
    }
  }

  private async generateNonStreaming(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    if (model.startsWith('claude-')) {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      });
      const content = response.content.filter(c => c.type === "text").map(c => (c as any).text).join('');
      return { content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    } else if (model.startsWith('gpt-')) {
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      });
      return { content: response.choices[0].message?.content || '', inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
    } else if (model.startsWith('gemini-')) {
      const geminiModel = this.gemini.getGenerativeModel({ model: model, systemInstruction: systemPrompt });
      // Map the messages array to the SDK-expected parts format
      const contents = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));
      // Execute the call using the proper object structure
      const result = await geminiModel.generateContent({ contents });
      // Securely parse the text response
      const content = result.response && typeof result.response.text === 'function' ? result.response.text() : '';
      // Extract usage metadata if provided by the 3.5 API tier
      const usage = result.response?.usageMetadata;
      return { 
        content, 
        inputTokens: usage?.promptTokenCount ?? 0, 
        outputTokens: usage?.candidatesTokenCount ?? 0 
      };
    } else if (model.startsWith('llama') || model.startsWith('mixtral')) {
      // Groq
      const response = await this.groq.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
      });
      return { content: response.choices[0].message?.content || '', inputTokens: response.usage?.prompt_tokens || 0, outputTokens: response.usage?.completion_tokens || 0 };
    } else if (model.startsWith('ollama/')) {
      const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.replace('ollama/', ''),
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
      });
      if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);
      const data = await response.json();
      return { content: data.message?.content || '', inputTokens: 0, outputTokens: 0 };
    } else {
      throw new Error(`Unsupported model for generation: ${model}`);
    }
  }

  async summarize(messages: LLMMessage[]): Promise<string> {
    const systemPrompt = `You are a summarization assistant. Your task is to summarize the conversation below in a concise, informative paragraph. Focus on key decisions, bugs fixed, design choices, and any conclusions reached. Keep the summary under 200 words.`;
    const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const userPrompt = `Summarize the following conversation:\n\n${conversationText}`;
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
 
  private async streamAnthropic(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
 
    const stream = await this.anthropic.messages.stream({
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
    inputTokens = finalMessage.usage.input_tokens;
    outputTokens = finalMessage.usage.output_tokens;
 
    callbacks.onComplete({ content: fullContent, inputTokens, outputTokens, model });
  }
 
  private async streamOpenAI(
    client: OpenAI, 
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;
 
    const stream = await client.chat.completions.create({
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
 
  private async streamGemini(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    const geminiModel = this.gemini.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
    });
    // Prepare history (exclude last message)
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
    const lastMessage = messages[messages.length - 1]?.content ?? '';
    const chat = geminiModel.startChat({ history });
    // Get full response and stream tokens
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

  private async streamM365Copilot(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    let fullContent = '';
    const response = await this.m365Copilot.chat.completions.create({
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
 
  private async streamGroq(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    let fullContent = '';
 
    const stream = await this.groq.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
 
    let inputTokens = 0;
    let outputTokens = 0;
 
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        callbacks.onToken(delta);
      }
      if (chunk.x_groq?.usage) {
        inputTokens = chunk.x_groq.usage.prompt_tokens;
        outputTokens = chunk.x_groq.usage.completion_tokens;
      }
    }
 
    callbacks.onComplete({ content: fullContent, inputTokens, outputTokens, model });
  }
 
  private async streamOllama(
    model: string,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
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
            // Optional: parse final stats if present
          } catch {
            // Ignore parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
 
    callbacks.onComplete({ content: fullContent, inputTokens: 0, outputTokens: 0, model });
  }
}