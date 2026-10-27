import {
  CONDITION_OPERATORS,
  CONSENT_REQUIREMENTS,
  ENVIRONMENTS,
  PARAMETER_FORMATS,
  PARAMETER_TYPES,
  PUBLIC_CONFIG_VERSION,
  TRIGGER_TYPES,
  type Condition,
  type ConsentRequirement,
  type Environment,
  type EventDefinition,
  type ParameterDefinition,
  type ProviderMapping,
  type PublicAnalyticsConfig,
  type PublicProviderSettings,
} from "../core/types.js";
import type { ProviderDefinition, StoredProviderSettings } from "../providers/types.js";

/**
 * Turns what the CMS stores into what the browser may know. It copies named fields only —
 * an allowlist — so a field added to the settings later stays private until a provider's
 * `project()` chooses to publish it. No Payload import: public routes call this.
 */

type Stored = Readonly<Record<string, unknown>>;

export type StoredAnalyticsSettings = Stored;
export type StoredAnalyticsEvent = Stored;

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

const list = (value: unknown): Stored[] => (Array.isArray(value) ? (value as Stored[]) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function environmentsOf(value: unknown): Environment[] {
  return Array.isArray(value) ? value.filter((item): item is Environment => isOneOf(ENVIRONMENTS, item)) : [];
}

function consentOf(value: unknown, fallback: ConsentRequirement): ConsentRequirement {
  return isOneOf(CONSENT_REQUIREMENTS, value) ? value : fallback;
}

function parameterOf(stored: Stored): ParameterDefinition | null {
  const name = text(stored.name);
  if (!name || !isOneOf(PARAMETER_TYPES, stored.type)) return null;
  const maxLength = typeof stored.maxLength === "number" && stored.maxLength > 0 ? stored.maxLength : undefined;
  return {
    name,
    type: stored.type,
    required: stored.required === true,
    format: isOneOf(PARAMETER_FORMATS, stored.format) ? stored.format : "text",
    ...(maxLength ? { maxLength } : {}),
    truncate: stored.truncate === true,
  };
}

function conditionOf(stored: Stored): Condition | null {
  const field = text(stored.field);
  if (!field || !isOneOf(CONDITION_OPERATORS, stored.operator)) return null;
  return stored.operator === "exists"
    ? { field, operator: stored.operator }
    : { field, operator: stored.operator, value: text(stored.value) };
}

function mappingOf(stored: Stored, active: ReadonlySet<string>): ProviderMapping | null {
  const provider = text(stored.provider);
  const eventName = text(stored.eventName);
  if (stored.enabled === false || !active.has(provider) || !eventName) return null;
  const override = isOneOf(CONSENT_REQUIREMENTS, stored.consent) ? stored.consent : undefined;
  return {
    provider,
    enabled: true,
    eventName,
    aliases: list(stored.aliases)
      .map((alias) => ({ parameter: text(alias.parameter), alias: text(alias.alias) }))
      .filter((alias) => alias.parameter && alias.alias),
    ...(override ? { consent: override } : {}),
    conditions: list(stored.conditions).map(conditionOf).filter((c): c is Condition => c !== null),
  };
}

function eventOf(stored: Stored, environment: Environment, active: ReadonlySet<string>): EventDefinition | null {
  const key = text(stored.eventKey);
  if (!key || stored.enabled === false || !isOneOf(TRIGGER_TYPES, stored.triggerType)) return null;
  const environments = environmentsOf(stored.environments);
  if (environments.length > 0 && !environments.includes(environment)) return null;

  /* A condition this code cannot read must not widen the audience, so it withholds the event. */
  const conditionsReadable = list(stored.mappings).every(
    (mapping) => list(mapping.conditions).every((condition) => conditionOf(condition) !== null),
  );
  if (!conditionsReadable) return null;

  return {
    key,
    triggerType: stored.triggerType,
    enabled: true,
    environments,
    consent: consentOf(stored.consent, "analytics"),
    parameters: list(stored.parameters).map(parameterOf).filter((p): p is ParameterDefinition => p !== null),
    mappings: list(stored.mappings)
      .map((mapping) => mappingOf(mapping, active))
      .filter((m): m is ProviderMapping => m !== null),
  };
}

/** Each provider's values from the host, by provider id; null where reading them failed. */
export type SuppliedValues = Readonly<Record<string, StoredProviderSettings | null>>;

/**
 * Reads every provider's `supply()` together. A failure is recorded as null rather than thrown,
 * so one unreadable source switches off its own provider and never the page's analytics.
 */
export async function readSupplied(providers: readonly ProviderDefinition[]): Promise<SuppliedValues> {
  const read = async (provider: ProviderDefinition) => {
    try {
      return await provider.supply!();
    } catch {
      return null;
    }
  };
  const entries = await Promise.all(
    providers.filter((provider) => provider.supply).map(async (provider) => [provider.id, await read(provider)] as const),
  );
  return Object.fromEntries(entries);
}

export type ProjectionInput = {
  settings: StoredAnalyticsSettings | null;
  events: readonly StoredAnalyticsEvent[];
  providers: readonly ProviderDefinition[];
  environment: Environment;
  /** What `readSupplied()` returned. Left out, a provider projects as if its host had nothing. */
  supplied?: SuppliedValues;
};

export type Projection = {
  config: PublicAnalyticsConfig;
  /** Providers left off, and why, for the host's logs and the admin preview. */
  skipped: Record<string, string>;
};

export function projectConfig({ settings, events, providers, environment, supplied }: ProjectionInput): Projection {
  const skipped: Record<string, string> = {};
  const allowed = environmentsOf(settings?.environments);
  const enabled = settings?.enabled === true && allowed.includes(environment);

  const publicProviders: Record<string, PublicProviderSettings> = {};
  if (enabled) {
    for (const provider of providers) {
      const stored = (settings?.[provider.id] ?? {}) as StoredProviderSettings;
      if (stored.enabled !== true) {
        skipped[provider.id] = "disabled";
        continue;
      }
      const given = supplied?.[provider.id];
      if (given === null) {
        skipped[provider.id] = "the host's values for it could not be read";
        continue;
      }
      const projected = provider.project(stored, environment, given ?? {});
      if ("off" in projected) {
        skipped[provider.id] = projected.off;
        continue;
      }
      publicProviders[provider.id] = {
        enabled: true,
        /* Debug output is never a production behaviour. */
        debug: stored.debug === true && environment !== "production",
        consent: consentOf(stored.consent, provider.defaultConsent),
        options: projected.options,
      };
    }
  }

  const active = new Set(Object.keys(publicProviders));
  return {
    skipped,
    config: {
      version: PUBLIC_CONFIG_VERSION,
      enabled,
      environment,
      debug: enabled && settings?.debug === true && environment !== "production",
      consent: {
        required: settings?.consentRequired !== false,
        whenUndecided: settings?.whenUndecided === "granted" ? "granted" : "denied",
      },
      unknownParameters: settings?.unknownParameters === "reject" ? "reject" : "drop",
      providers: publicProviders,
      events: enabled
        ? events.map((event) => eventOf(event, environment, active)).filter((e): e is EventDefinition => e !== null)
        : [],
    },
  };
}

export type ConfigSource = {
  readSettings(): Promise<StoredAnalyticsSettings | null>;
  readEvents(): Promise<readonly StoredAnalyticsEvent[]>;
};

export type ConfigLoader = {
  load(): Promise<Projection>;
  /** Drops the cached copy; the next `load()` reads the source again. */
  invalidate(): void;
};

/**
 * One source read per `ttlMs` however many pages render, never one per tracked event, and
 * concurrent loads share it. A load with any failed read is not kept; a failed `supply()`
 * leaves only its provider off, for that load.
 */
export function createConfigLoader({
  source,
  providers,
  environment,
  ttlMs = 60_000,
  now = Date.now,
}: {
  source: ConfigSource;
  providers: readonly ProviderDefinition[];
  environment: Environment;
  ttlMs?: number;
  now?: () => number;
}): ConfigLoader {
  let cached: { at: number; value: Promise<Projection> } | null = null;

  return {
    load() {
      if (cached && now() - cached.at < ttlMs) return cached.value;
      const entry = { at: now() } as { at: number; value: Promise<Projection> };
      const forget = () => {
        if (cached === entry) cached = null;
      };
      entry.value = Promise.all([source.readSettings(), source.readEvents(), readSupplied(providers)]).then(
        ([settings, events, supplied]) => {
          if (Object.values(supplied).includes(null)) forget();
          return projectConfig({ settings, events, providers, environment, supplied });
        },
      );
      cached = entry;
      entry.value.catch(forget);
      return entry.value;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** The config as a `<script type="application/json">` body: `<` escaped so it cannot close the tag. */
export function serializeConfig(config: PublicAnalyticsConfig): string {
  return JSON.stringify(config).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
