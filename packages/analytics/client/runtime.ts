import { createDispatcher, type DispatchReport } from "../core/dispatcher.js";
import { sameConsent, UNDECIDED } from "../core/consent.js";
import { createLogger, type Sink } from "../core/logger.js";
import { createEventRegistry } from "../core/registry.js";
import type { ConsentState, EventPayload, ParameterValue, PublicAnalyticsConfig } from "../core/types.js";
import { createProviderRegistry } from "../providers/registry.js";
import type { AnalyticsProvider } from "../providers/types.js";

/**
 * The one analytics API a site uses. It knows no provider by name: it is handed adapters
 * and the published configuration, and every call is safe to make at any time — before
 * installation, on the server, or after an adapter has failed.
 */

export type RuntimeOptions = {
  config: PublicAnalyticsConfig;
  providers: readonly AnalyticsProvider[];
  consent?: ConsentState;
  /** Values the host wants on every provider's first hit, such as an internal-traffic marker. */
  globals?: Readonly<Record<string, ParameterValue>>;
  /** False on routes the host never measures; nothing is initialised or sent there. */
  isMeasured?: (pathname: string) => boolean;
  sink?: Sink;
};

export type AnalyticsRuntime = {
  readonly config: PublicAnalyticsConfig;
  /** Synchronous, before hydration: what each provider needs ahead of its script. */
  bootstrap(): void;
  /** After hydration: loads provider scripts. Idempotent. */
  start(): void;
  track(key: string, payload?: EventPayload): DispatchReport | undefined;
  /** `track("page_view", …)`, routed to each provider's page tracking. */
  page(payload?: EventPayload): DispatchReport | undefined;
  setConsent(state: ConsentState): void;
  consent(): ConsentState;
};

function currentPath(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

export function createAnalyticsRuntime(options: RuntimeOptions): AnalyticsRuntime {
  const { config } = options;
  const logger = createLogger(config.debug, options.sink);
  const isMeasured = options.isMeasured ?? (() => true);
  const globals = options.globals ?? {};
  let consent: ConsentState = options.consent ?? UNDECIDED;

  /* Only providers the configuration switched on. A broken adapter is left out, not fatal. */
  const active = createProviderRegistry();
  for (const provider of options.providers) {
    if (!config.providers[provider.name]) continue;
    try {
      active.register(provider);
    } catch (error) {
      logger.note(`provider ${provider.name} not registered`, error instanceof Error ? error.message : error);
    }
  }
  const adapters = active.names().map((name) => active.resolve(name)!);

  const dispatcher = createDispatcher({
    config,
    events: createEventRegistry(config.events),
    providers: active,
    consent: () => consent,
    facts: () => ({ pagePath: currentPath(), environment: config.environment }),
    logger,
  });

  let bootstrapped = false;
  let started = false;

  /* Each adapter call is isolated: one provider throwing never stops the next. */
  const each = (step: string, call: (adapter: AnalyticsProvider) => void) => {
    for (const adapter of adapters) {
      try {
        call(adapter);
      } catch (error) {
        logger.note(`${adapter.name} ${step} failed`, error instanceof Error ? error.message : error);
      }
    }
  };

  const enabledHere = () => config.enabled && isMeasured(currentPath());

  const runtime: AnalyticsRuntime = {
    config,
    bootstrap() {
      if (bootstrapped || !enabledHere()) return;
      bootstrapped = true;
      each("bootstrap", (adapter) =>
        adapter.bootstrap?.(config.providers[adapter.name]!, { ...dispatcher.contextFor(adapter.name, consent), globals }),
      );
    },
    start() {
      if (started || !enabledHere()) return;
      runtime.bootstrap();
      started = true;
      each("initialize", (adapter) =>
        adapter.initialize(config.providers[adapter.name]!, dispatcher.contextFor(adapter.name, consent)),
      );
    },
    track(key, payload) {
      try {
        if (!isMeasured(currentPath())) return undefined;
        return dispatcher.dispatch(key, payload);
      } catch {
        return undefined;
      }
    },
    page(payload) {
      return runtime.track("page_view", payload);
    },
    setConsent(state) {
      if (sameConsent(state, consent)) return;
      consent = { ...state };
      if (!started) return;
      each("consent update", (adapter) => adapter.updateConsent?.(dispatcher.contextFor(adapter.name, consent)));
    },
    consent: () => consent,
  };
  return runtime;
}

/* ---- The installed instance --------------------------------------------------------------
   Anchored on `window`, not a module variable or React context: a bundler may give the code
   that installs it and the code that tracks separate copies of this module. */

const GLOBAL_KEY = "__payloadAnalyticsRuntime";

type Anchor = { [GLOBAL_KEY]?: AnalyticsRuntime };

export function installAnalytics(options: RuntimeOptions): AnalyticsRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  const anchor = window as unknown as Anchor;
  if (anchor[GLOBAL_KEY]) return anchor[GLOBAL_KEY];
  try {
    anchor[GLOBAL_KEY] = createAnalyticsRuntime(options);
    return anchor[GLOBAL_KEY];
  } catch {
    return undefined;
  }
}

export function installedAnalytics(): AnalyticsRuntime | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as Anchor)[GLOBAL_KEY];
}

/** For tests: forget the installed instance. */
export function uninstallAnalytics(): void {
  if (typeof window !== "undefined") delete (window as unknown as Anchor)[GLOBAL_KEY];
}
