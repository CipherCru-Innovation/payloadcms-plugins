import type { BrowserHost } from "../providers/dom.js";
import type {
  ConsentState,
  EventDefinition,
  ParameterDefinition,
  PublicAnalyticsConfig,
  PublicProviderSettings,
} from "../core/types.js";
import type { AnalyticsProvider, AnalyticsContext, DispatchEvent, ProviderDefinition } from "../providers/types.js";

/** A provider whose one value the host keeps and hands over through `supply()`. */
export function hostValueProvider(read: () => Promise<string | null | undefined> = async () => "k-1"): ProviderDefinition {
  const key = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return {
    id: "hosted",
    label: "Hosted",
    description: "Its key is set in the host.",
    defaultConsent: "none",
    csp: {},
    fields: [],
    supply: async () => ({ key: key(await read()) }),
    project: (_stored, _environment, supplied = {}) =>
      key(supplied.key) ? { options: { key: key(supplied.key) } } : { off: "no key from the host" },
    validateSettings(own, _all, supplied) {
      if (own.enabled !== true) return true;
      if (supplied === null) return "The host's key could not be read.";
      return key(supplied?.key) ? true : "The host has no key.";
    },
  };
}

/** A browser just large enough for the adapters: scripts, queues and a location. */
export type FakeScript = { id: string; src: string; async: boolean; fail(): void };

export function fakeHost(pathname = "/"): BrowserHost & { scripts: FakeScript[]; location: { pathname: string } } {
  const scripts: FakeScript[] = [];
  const location = { pathname, href: `https://example.test${pathname}` };
  const document = {
    getElementById: (id: string) => scripts.find((script) => script.id === id) ?? null,
    createElement: () => {
      const listeners: Record<string, () => void> = {};
      const script: FakeScript & { addEventListener(type: string, fn: () => void): void } = {
        id: "",
        src: "",
        async: false,
        addEventListener: (type, fn) => {
          listeners[type] = fn;
        },
        fail: () => listeners.error?.(),
      };
      return script;
    },
    head: { appendChild: (script: FakeScript) => scripts.push(script) },
  };
  const window = { location } as unknown as BrowserHost["window"];
  return { window, document: document as unknown as Document, scripts, location };
}

export const GRANTED: ConsentState = { decided: true, analytics: true, marketing: true };
export const DENIED: ConsentState = { decided: true, analytics: false, marketing: false };
export const UNDECIDED: ConsentState = { decided: false, analytics: false, marketing: false };

export function context(overrides: Partial<AnalyticsContext> = {}): AnalyticsContext {
  return { environment: "production", consent: GRANTED, permitted: true, debug: false, ...overrides };
}

export function parameter(name: string, overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return { name, type: "string", required: false, format: "text", truncate: false, ...overrides };
}

export function event(overrides: Partial<EventDefinition> = {}): EventDefinition {
  return {
    key: "contact_form_submit",
    triggerType: "form_submit",
    enabled: true,
    environments: [],
    consent: "none",
    parameters: [parameter("form_location"), parameter("service")],
    mappings: [
      { provider: "alpha", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] },
    ],
    ...overrides,
  };
}

export function provider(settings: Partial<PublicProviderSettings> = {}): PublicProviderSettings {
  return { enabled: true, debug: false, consent: "none", options: {}, ...settings };
}

export function config(overrides: Partial<PublicAnalyticsConfig> = {}): PublicAnalyticsConfig {
  return {
    version: 1,
    enabled: true,
    environment: "production",
    debug: false,
    consent: { required: true, whenUndecided: "denied" },
    unknownParameters: "drop",
    providers: { alpha: provider(), beta: provider() },
    events: [event()],
    ...overrides,
  };
}

/** An adapter that records what reached it. */
export function recorder(name: string, behaviour: Partial<AnalyticsProvider> = {}) {
  const received: { method: "track" | "page"; event: DispatchEvent; context: AnalyticsContext }[] = [];
  const consentUpdates: AnalyticsContext[] = [];
  const adapter: AnalyticsProvider = {
    name,
    isAvailable: () => true,
    initialize: () => undefined,
    track: (event, context) => {
      received.push({ method: "track", event, context });
    },
    page: (event, context) => {
      received.push({ method: "page", event, context });
    },
    updateConsent: (context) => {
      consentUpdates.push(context);
    },
    ...behaviour,
  };
  return { adapter, received, consentUpdates };
}

/** A console that remembers instead of printing. */
export function memorySink() {
  const lines: unknown[][] = [];
  return {
    lines,
    sink: {
      groupCollapsed: (...args: unknown[]) => lines.push(["group", ...args]),
      groupEnd: () => lines.push(["end"]),
      log: (...args: unknown[]) => lines.push(["log", ...args]),
      warn: (...args: unknown[]) => lines.push(["warn", ...args]),
    },
  };
}
