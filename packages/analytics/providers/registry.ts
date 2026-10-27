import type { AnalyticsProvider } from "./types.js";

/**
 * Where adapters are registered and resolved by name. The dispatcher asks this and nothing
 * else, so it never needs to know which providers exist.
 */
export type ProviderRegistry = {
  register(provider: AnalyticsProvider): void;
  resolve(name: string): AnalyticsProvider | undefined;
  has(name: string): boolean;
  names(): string[];
};

export class DuplicateProviderError extends Error {
  constructor(name: string) {
    super(`An analytics provider named "${name}" is already registered.`);
    this.name = "DuplicateProviderError";
  }
}

export const PROVIDER_NAME = /^[a-z][a-z0-9]*$/;

export function createProviderRegistry(providers: readonly AnalyticsProvider[] = []): ProviderRegistry {
  const byName = new Map<string, AnalyticsProvider>();

  const registry: ProviderRegistry = {
    register(provider) {
      if (!PROVIDER_NAME.test(provider.name)) {
        throw new Error(`"${provider.name}" is not a valid provider name: use lowercase letters and digits.`);
      }
      if (byName.has(provider.name)) throw new DuplicateProviderError(provider.name);
      byName.set(provider.name, provider);
    },
    resolve: (name) => byName.get(name),
    has: (name) => byName.has(name),
    names: () => [...byName.keys()],
  };

  for (const provider of providers) registry.register(provider);
  return registry;
}
