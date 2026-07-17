import { z } from 'zod';
import { MODEL_FALLBACK_CHAIN, TOOL_TIMEOUT_MS } from '../constants';

// -------------------------------------------------------------------------------------------------
// Unified app configuration schema. A single source of truth for settings that were previously
// scattered across independent process.env reads in server.ts, app.ts, logger.ts, and elsewhere.
//
// Path fields (`paths.*`) are intentionally left optional with no default here — this package has
// no filesystem access, so real defaults (relative to the running process) are computed by
// ConfigManager in the backend before validation, not baked in here.

export const AppConfigSchema = z.object({
  server: z.object({
    port: z.number().int().min(1).max(65535).default(5000),
    frontendUrl: z.string().url().default('http://localhost:3000'),
  }).default({}),

  llm: z.object({
    // Not yet consumed — every agent config already requires an explicit baseModel, so there's
    // no current call site that falls back to a "default" model. Reserved for a future one.
    defaultModel: z.string().default(MODEL_FALLBACK_CHAIN[0]),
    fallbackChain: z.array(z.string()).default([...MODEL_FALLBACK_CHAIN]),
    // Not yet consumed anywhere at runtime — TaskAwareRouter (the only prompt-cache TTL
    // consumer) isn't wired into the app. Reserved here for when it is.
    cacheTTL: z.number().int().min(0).default(60_000),
  }).default({}),

  eda: z.object({
    verilatorPath: z.string().optional(),
    openroadPath: z.string().optional(),
    openstaPath: z.string().optional(),
    timeout: z.number().int().min(1000).default(TOOL_TIMEOUT_MS),
  }).default({}),

  docker: z.object({
    enabled: z.boolean().default(false),
    image: z.string().default('rtl-tools:latest'),
  }).default({}),

  paths: z.object({
    workspaceRoot: z.string().optional(),
    configRoot: z.string().optional(),
    skillsRoot: z.string().optional(),
    telemetryRoot: z.string().optional(),
  }).default({}),

  telemetry: z.object({
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  }).default({}),

  // RAG pipeline shell (Qdrant). Disabled by default — no source documents are ingested until
  // one deliberately drops files into rag_sources/ and calls POST /api/rag/ingest. Everything
  // here degrades gracefully (query_rag returns no results, not an error) when Qdrant isn't
  // reachable, which is the expected default state.
  rag: z.object({
    enabled: z.boolean().default(false),
    qdrantUrl: z.string().default('http://localhost:6333'),
    collectionName: z.string().default('design_docs'),
    embeddingModel: z.string().default('text-embedding-3-small'),
    // Must match the embedding model's actual output dimensionality.
    embeddingDimensions: z.number().int().min(1).default(1536),
    embeddingApiKeyEnv: z.string().default('OPENAI_API_KEY'),
    embeddingBaseURL: z.string().url().optional(),
    chunkSize: z.number().int().min(100).default(1000),
    chunkOverlap: z.number().int().min(0).default(150),
    topK: z.number().int().min(1).default(5),
  }).default({}),

  // JWT auth. jwtSecret is intentionally optional with no static default — ConfigManager
  // generates a random one at boot (logged as a warning) when unset, rather than shipping a
  // predictable fallback secret.
  auth: z.object({
    jwtSecret: z.string().optional(),
    tokenExpiryMinutes: z.number().int().min(1).default(60),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
