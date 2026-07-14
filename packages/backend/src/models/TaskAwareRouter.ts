import type { BaseModel } from '@agent_design/shared/types';
import type { LLMMessage, StreamCallback } from './ModelRouter';
import { ModelRouter } from './ModelRouter';
import { PromptCache } from './PromptCache';
import { logger } from '../utils/logger';

// Task complexity tiers
export type TaskComplexity = 'low' | 'medium' | 'high';

/**
 * Keyword sets used for heuristic complexity classification.
 * EDA/hardware domain keywords push toward higher complexity.
 */
const HIGH_COMPLEXITY_KEYWORDS = [
  'openroad', 'opensta', 'synthesis', 'place and route', 'timing closure',
  'floorplan', 'power delivery', 'parasitic', 'pnr', 'gds', 'gdsii',
  'liberty', 'sta', 'critical path', 'wns', 'tns', 'constraint manifest',
];

const MEDIUM_COMPLEXITY_KEYWORDS = [
  'verilog', 'systemverilog', 'testbench', 'simulation', 'verilator',
  'rtl', 'module', 'pipeline', 'finite state machine', 'fsm',
  'debug', 'refactor', 'rewrite', 'analyse', 'analyze', 'compare',
];

/** Tokens above which we promote to a higher tier. */
const HIGH_TOKEN_THRESHOLD = 2000;
const MEDIUM_TOKEN_THRESHOLD = 500;

// ── Per-tier model chains ──────────────────────────────────────────────────────

const TIER_CHAINS: Record<TaskComplexity, string[]> = {
  low: [
    'gemini-3.5-flash',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
    'ollama/codellama',
  ],
  medium: [
    'claude-3-haiku-20240307',
    'gpt-4o-mini',
    'gemini-3.1-pro',
  ],
  high: [
    'claude-3-5-sonnet-20241022',
    'gpt-4o',
    'claude-3-opus-20240229',
  ],
};

/**
 * TaskAwareRouter wraps ModelRouter with:
 *  - Task complexity classification → tier-based model selection.
 *  - Model name normalisation.
 *  - TTL prompt cache (avoids re-prefilling identical prompts).
 *  - Transparent fallback through a tier-appropriate chain.
 */
export class TaskAwareRouter {
  private readonly cache: PromptCache;

  constructor(
    private readonly modelRouter: ModelRouter,
    cacheTtlMs = 60_000,
  ) {
    this.cache = new PromptCache(cacheTtlMs);
  }

  // ── Public helpers ─────────────────────────────────────────────────────────

  /**
   * Classify task complexity from the system prompt + message content.
   * Returns 'high', 'medium', or 'low'.
   */
  classifyTask(systemPrompt: string, messages: LLMMessage[]): TaskComplexity {
    const combined = [
      systemPrompt,
      ...messages.map((m) => m.content),
    ].join(' ').toLowerCase();

    // Token-length heuristic
    const approxTokens = combined.length / 4;
    if (approxTokens > HIGH_TOKEN_THRESHOLD) return 'high';

    // Keyword heuristics
    if (HIGH_COMPLEXITY_KEYWORDS.some((kw) => combined.includes(kw))) return 'high';
    if (MEDIUM_COMPLEXITY_KEYWORDS.some((kw) => combined.includes(kw))) return 'medium';
    if (approxTokens > MEDIUM_TOKEN_THRESHOLD) return 'medium';

    return 'low';
  }

  /**
   * Primary streaming entry-point.
   *
   * Strategy:
   *  1. Check the prompt cache — if hit, replay via onToken/onComplete.
   *  2. Determine task complexity; build the tier chain.
   *  3. Prepend the caller's preferred model (normalised).
   *  4. Iterate through the chain, using ModelRouter.tryModel (now public).
   *  5. Cache successful responses.
   */
  async streamCompletion(
    preferredModel: BaseModel,
    systemPrompt: string,
    messages: LLMMessage[],
    callbacks: StreamCallback,
  ): Promise<void> {
    // ── Cache check ──────────────────────────────────────────────────────────
    const cacheKey = PromptCache.buildKey(systemPrompt, messages);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      // Replay cached response synchronously so callers don't block.
      callbacks.onToken(cached);
      callbacks.onComplete({
        content: cached,
        inputTokens: 0,
        outputTokens: 0,
        model: `${preferredModel}[cache]`,
      });
      return;
    }

    // ── Build model chain ────────────────────────────────────────────────────
    const normalisedPreferred = preferredModel;
    const complexity = this.classifyTask(systemPrompt, messages);
    const tierChain = TIER_CHAINS[complexity].filter((m) => m !== normalisedPreferred); // avoid duplicating preferred

    const chain: string[] = [normalisedPreferred, ...tierChain];

    logger.info('TaskAwareRouter: routing', {
      preferred: normalisedPreferred,
      complexity,
      chainLength: chain.length,
    });

    // ── Iterate through chain ────────────────────────────────────────────────
    let fullContent = '';
    let lastError: Error | null = null;

    for (const model of chain) {
      try {
        const startMs = Date.now();

        // Intercept onToken/onComplete to accumulate content for caching.
        let accumulated = '';
        await this.modelRouter.tryModel(model, systemPrompt, messages, {
          onToken: (tok) => {
            accumulated += tok;
            callbacks.onToken(tok);
          },
          onComplete: (resp) => {
            fullContent = accumulated;
            logger.info('TaskAwareRouter: model succeeded', {
              model,
              latencyMs: Date.now() - startMs,
              complexity,
            });
            callbacks.onComplete(resp);
          },
          onError: (err) => {
            // Don't surface to caller yet; we'll try the next model.
            lastError = err;
            throw err; // re-throw to exit the for-loop iteration
          },
        });

        // ── Cache the successful response ──────────────────────────────────
        if (fullContent) {
          this.cache.set(cacheKey, fullContent);
        }
        return; // success

      } catch (err) {
        lastError = err as Error;
        logger.warn('TaskAwareRouter: model failed, trying next', {
          model,
          error: (err as Error).message,
        });
      }
    }

    // All models exhausted
    const finalErr = lastError ?? new Error('All models in tier chain failed');
    callbacks.onError(finalErr);
    throw finalErr;
  }

  /** Expose cache for testing / metrics. */
  get promptCache(): PromptCache {
    return this.cache;
  }
}