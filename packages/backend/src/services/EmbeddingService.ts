import OpenAI from 'openai';
import { ConfigManager } from '../config/ConfigManager';

// Thin wrapper around an embeddings-capable OpenAI-compatible client. Deliberately independent
// of the provider registry (packages/backend/src/models/*) — embeddings aren't chat completions
// and don't need the full LLMProvider interface, just a base URL + API key.
export class EmbeddingService {
  private client: OpenAI;
  private readonly model: string;
  private readonly apiKeyEnv: string;

  constructor() {
    const { rag } = ConfigManager.getInstance().get();
    this.model = rag.embeddingModel;
    this.apiKeyEnv = rag.embeddingApiKeyEnv;
    this.client = new OpenAI({
      apiKey: process.env[this.apiKeyEnv] || 'dummy',
      baseURL: rag.embeddingBaseURL,
    });
  }

  isAvailable(): boolean {
    return !!process.env[this.apiKeyEnv];
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({ model: this.model, input: text });
    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({ model: this.model, input: texts });
    return response.data.map((d) => d.embedding);
  }
}
