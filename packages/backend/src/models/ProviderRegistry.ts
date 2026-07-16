import type { LLMProvider } from './LLMProvider';
import type { ProviderStatus } from '@agent_design/shared/types';
import { logger } from '../utils/logger';

interface PrefixEntry {
  prefix: string;
  providerId: string;
}

export interface RegistryModelEntry {
  id: string;
  providerId: string;
  providerName: string;
  costTier: string;
  available: boolean;
}

// Holds every registered LLMProvider and routes model IDs to the provider that serves them.
// ModelRouter depends only on this registry — never on a concrete SDK client — so adding a
// provider is a matter of registering an LLMProvider implementation, not editing ModelRouter.
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private modelToProvider = new Map<string, string>();
  private prefixes: PrefixEntry[] = [];

  register(provider: LLMProvider, modelPrefixes: string[] = []): void {
    this.providers.set(provider.id, provider);

    for (const prefix of modelPrefixes) {
      this.prefixes.push({ prefix, providerId: provider.id });
    }
    // Longest prefix first so e.g. a more specific prefix always wins over a shorter one.
    this.prefixes.sort((a, b) => b.prefix.length - a.prefix.length);

    const models = provider.getSupportedModels();
    if (Array.isArray(models)) {
      models.forEach((model) => this.modelToProvider.set(model, provider.id));
    } else {
      models.then((resolved) => resolved.forEach((model) => this.modelToProvider.set(model, provider.id)))
        .catch((err) => logger.warn(`Failed to resolve models for provider ${provider.id}`, { error: (err as Error).message }));
    }

    logger.info(`Registered provider: ${provider.id} (${provider.type})`);
  }

  getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getProviderForModel(model: string): LLMProvider | undefined {
    const providerId = this.modelToProvider.get(model);
    if (providerId) return this.providers.get(providerId);

    const match = this.prefixes.find((p) => model.startsWith(p.prefix));
    return match ? this.providers.get(match.providerId) : undefined;
  }

  getAllProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  getAvailableProviders(): LLMProvider[] {
    return this.getAllProviders().filter((p) => p.isAvailable());
  }

  // Aggregates every registered provider's models for the model-listing API — including
  // providers that aren't currently available (e.g. no API key set yet), so the frontend can
  // still list and select them, tagged with `available`. Awaits each provider fresh rather than
  // relying on the (possibly still-populating) lookup maps above.
  async listModels(): Promise<RegistryModelEntry[]> {
    const entries: RegistryModelEntry[] = [];
    for (const provider of this.getAllProviders()) {
      const models = await provider.getSupportedModels();
      const costTier = provider.getMetadata().costTier;
      const available = provider.isAvailable();
      for (const id of models) {
        entries.push({ id, providerId: provider.id, providerName: provider.name, costTier, available });
      }
    }
    return entries;
  }

  getProviderStatuses(): ProviderStatus[] {
    return this.getAllProviders().map((provider) => {
      const meta = provider.getMetadata();
      return {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        available: provider.isAvailable(),
        costTier: meta.costTier,
        modelCount: meta.models.length,
      };
    });
  }
}
