import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';
import { EmbeddingService } from './EmbeddingService';
import { logger } from '../utils/logger';

export interface RagQueryResult {
  text: string;
  source: string;
  score: number;
}

// Chunks a document into overlapping windows. Naive character-based splitter — good enough for
// a pipeline shell with no real documents loaded yet; swap for a smarter (sentence/token-aware)
// splitter once real source material is ingested.
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

// RAG pipeline shell over Qdrant: ingest text/directories, embed via EmbeddingService, query by
// similarity. Designed to degrade gracefully — the server must boot and keep working normally
// whether or not Qdrant is actually running; a query_rag tool call against an unavailable RAG
// service returns no results (logged) rather than throwing and failing an agent's turn.
export class RagService {
  private static instance: RagService | undefined;

  private client: QdrantClient | null = null;
  private embeddings: EmbeddingService;
  private available = false;
  private connecting: Promise<void> | null = null;

  private constructor() {
    this.embeddings = new EmbeddingService();
    const { rag } = ConfigManager.getInstance().get();
    if (rag.enabled) {
      this.connecting = this.connect();
    }
  }

  static getInstance(): RagService {
    if (!RagService.instance) {
      RagService.instance = new RagService();
    }
    return RagService.instance;
  }

  private async connect(): Promise<void> {
    const { rag } = ConfigManager.getInstance().get();
    try {
      this.client = new QdrantClient({ url: rag.qdrantUrl });
      const existing = await this.client.getCollections();
      const hasCollection = existing.collections.some((c) => c.name === rag.collectionName);
      if (!hasCollection) {
        await this.client.createCollection(rag.collectionName, {
          vectors: { size: rag.embeddingDimensions, distance: 'Cosine' },
        });
        logger.info('RagService: created Qdrant collection', { collection: rag.collectionName });
      }
      this.available = true;
      logger.info('RagService: connected to Qdrant', { url: rag.qdrantUrl, collection: rag.collectionName });
    } catch (err) {
      this.available = false;
      logger.warn('RagService: Qdrant unavailable — RAG features disabled', { error: (err as Error).message });
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async ingestText(text: string, metadata: { source: string }): Promise<{ chunks: number }> {
    await this.connecting;
    if (!this.available || !this.client) {
      logger.warn('RagService.ingestText called while unavailable — skipped', { source: metadata.source });
      return { chunks: 0 };
    }

    const { rag } = ConfigManager.getInstance().get();
    const chunks = chunkText(text, rag.chunkSize, rag.chunkOverlap);
    if (chunks.length === 0) return { chunks: 0 };

    const vectors = await this.embeddings.embedBatch(chunks);
    await this.client.upsert(rag.collectionName, {
      wait: true,
      points: chunks.map((chunk, i) => ({
        id: uuidv4(),
        vector: vectors[i],
        payload: { text: chunk, source: metadata.source },
      })),
    });

    logger.info('RagService: ingested document', { source: metadata.source, chunks: chunks.length });
    return { chunks: chunks.length };
  }

  async ingestDirectory(dirPath: string): Promise<{ filesIngested: number; chunks: number }> {
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      logger.warn('RagService.ingestDirectory: directory not found', { dirPath });
      return { filesIngested: 0, chunks: 0 };
    }

    const docFiles = entries.filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    let totalChunks = 0;
    for (const file of docFiles) {
      const filePath = path.join(dirPath, file);
      const text = await fs.readFile(filePath, 'utf-8');
      const { chunks } = await this.ingestText(text, { source: file });
      totalChunks += chunks;
    }

    return { filesIngested: docFiles.length, chunks: totalChunks };
  }

  async query(text: string, topK?: number): Promise<RagQueryResult[]> {
    await this.connecting;
    if (!this.available || !this.client) {
      logger.warn('RagService.query called while unavailable — returning no results');
      return [];
    }

    const { rag } = ConfigManager.getInstance().get();
    const vector = await this.embeddings.embed(text);
    const results = await this.client.search(rag.collectionName, {
      vector,
      limit: topK ?? rag.topK,
    });

    return results.map((r) => ({
      text: String((r.payload as Record<string, unknown> | undefined)?.text ?? ''),
      source: String((r.payload as Record<string, unknown> | undefined)?.source ?? 'unknown'),
      score: r.score,
    }));
  }
}
