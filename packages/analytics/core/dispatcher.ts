import type { ProviderRegistry } from "../providers/registry.js";
import type { AnalyticsContext, DispatchEvent, DispatchResult } from "../providers/types.js";
import { evaluateConditions } from "./conditions.js";
import { destinationPermitted, isPermitted } from "./consent.js";
import type { EventTrace, Logger, ProviderOutcome } from "./logger.js";
import type { EventRegistry } from "./registry.js";
import type {
  ConsentState,
  EventDefinition,
  EventPayload,
  ParameterValue,
  ProviderMapping,
  PublicAnalyticsConfig,
} from "./types.js";
import { validatePayload } from "./validator.js";

/**
 * The pipeline between `track()` and the adapters: registry, validation, then for each
 * destination its conditions, the consent gate and aliasing. It runs synchronously, so two
 * events tracked in one tick reach every destination in that order, and it never throws.
 */

export type DispatchReport = EventTrace;

export type DispatcherDependencies = {
  config: PublicAnalyticsConfig;
  events: EventRegistry;
  providers: ProviderRegistry;
  consent: () => ConsentState;
  /** Facts conditions may test besides the parameters, such as `pagePath`. */
  facts: () => Readonly<Record<string, ParameterValue | undefined>>;
  logger: Logger;
};

function applyAliases(params: Record<string, ParameterValue>, mapping: ProviderMapping): Record<string, ParameterValue> {
  if (mapping.aliases.length === 0) return { ...params };
  const renamed = new Map(mapping.aliases.map((alias) => [alias.parameter, alias.alias]));
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [renamed.get(name) ?? name, value]));
}

function isThenable(value: unknown): value is PromiseLike<DispatchResult> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

export function createDispatcher(deps: DispatcherDependencies) {
  const { config, events, providers, logger } = deps;

  function contextFor(providerName: string, consent: ConsentState): AnalyticsContext {
    const settings = config.providers[providerName];
    return {
      environment: config.environment,
      consent,
      permitted: settings ? isPermitted(settings.consent, consent, config.consent) : false,
      debug: config.debug || Boolean(settings?.debug),
    };
  }

  function deliver(definition: EventDefinition, mapping: ProviderMapping, params: Record<string, ParameterValue>, consent: ConsentState): ProviderOutcome {
    const outcome: ProviderOutcome = { provider: mapping.provider, eventName: mapping.eventName, status: "skipped" };
    const settings = config.providers[mapping.provider];
    const adapter = providers.resolve(mapping.provider);
    if (!settings) return { ...outcome, reason: "provider disabled" };
    if (!adapter) return { ...outcome, reason: "no adapter registered" };

    const conditions = evaluateConditions(mapping.conditions, params, deps.facts());
    if (!conditions.ok) return { ...outcome, reason: conditions.reason };

    const gate = destinationPermitted([mapping.consent ?? definition.consent, settings.consent], consent, config.consent);
    if (!gate.permitted) return { ...outcome, reason: `${gate.missing} consent not given` };

    if (!adapter.isAvailable()) return { ...outcome, reason: "provider unavailable" };

    const event: DispatchEvent = {
      key: definition.key,
      name: mapping.eventName,
      triggerType: definition.triggerType,
      params: applyAliases(params, mapping),
    };
    const context = contextFor(mapping.provider, consent);

    try {
      const result =
        definition.triggerType === "page_view" && adapter.page ? adapter.page(event, context) : adapter.track(event, context);
      if (isThenable(result)) {
        /* Reported as sent; a later rejection is logged, never thrown. */
        result.then(undefined, (error: unknown) =>
          logger.note(`${mapping.provider} failed to send ${mapping.eventName}`, error instanceof Error ? error.message : error),
        );
        return { ...outcome, status: "sent", params: event.params };
      }
      if (result && "skipped" in result) return { ...outcome, reason: result.skipped };
      return { ...outcome, status: "sent", params: event.params };
    } catch (error) {
      return { ...outcome, status: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  function dispatch(key: string, payload?: EventPayload): DispatchReport {
    const received = payload && typeof payload === "object" ? payload : {};
    const trace: EventTrace = { event: key, received, registry: "matched", providers: [] };

    try {
      if (!config.enabled) {
        trace.ignored = "analytics is off";
        return trace;
      }
      const definition = events.lookup(key);
      if (!definition) {
        trace.registry = "unknown";
        trace.ignored = "not in the registry, disabled, or not for this environment";
        return trace;
      }

      const validation = validatePayload(definition, payload, config.unknownParameters);
      trace.validation = validation.ok
        ? { ok: true, params: validation.params, dropped: validation.dropped }
        : { ok: false, reason: validation.reason, dropped: validation.dropped };
      if (!validation.ok) {
        trace.ignored = `validation failed: ${validation.reason}`;
        return trace;
      }

      const consent = deps.consent();
      trace.consent = { decided: consent.decided, analytics: consent.analytics, marketing: consent.marketing };

      if (definition.mappings.length === 0) trace.ignored = "no destinations";
      for (const mapping of definition.mappings) {
        trace.providers.push(deliver(definition, mapping, validation.params, consent));
      }
      return trace;
    } catch (error) {
      trace.ignored = `internal error: ${error instanceof Error ? error.message : String(error)}`;
      return trace;
    } finally {
      logger.event(trace);
    }
  }

  return { dispatch, contextFor };
}

export type Dispatcher = ReturnType<typeof createDispatcher>;
