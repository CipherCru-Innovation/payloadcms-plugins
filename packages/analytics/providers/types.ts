import type { Field } from "payload";

import type {
  ConsentRequirement,
  ConsentState,
  Environment,
  ParameterValue,
  PublicProviderSettings,
  TriggerType,
} from "../core/types.js";

/**
 * The two halves of a provider. The definition is server-side: its settings fields, how
 * those become public configuration, and the hosts the CSP must allow. The adapter is the
 * browser half. A new destination is one folder holding both, and nothing else changes.
 */

/** One event as a destination receives it, after routing, consent and aliasing. */
export type DispatchEvent = {
  /** The internal key the site tracked. */
  key: string;
  /** The destination's own name for it. */
  name: string;
  triggerType: TriggerType;
  params: Readonly<Record<string, ParameterValue>>;
};

export type AnalyticsContext = {
  environment: Environment;
  consent: ConsentState;
  /** Whether this destination's consent requirement is met, decided by the central gate. */
  permitted: boolean;
  debug: boolean;
};

/** Values the host wants set before the first hit, such as a traffic-type marker. */
export type BootstrapContext = AnalyticsContext & {
  globals: Readonly<Record<string, ParameterValue>>;
};

/** An adapter reports a skip instead of throwing; anything else counts as sent. */
export type DispatchResult = void | { skipped: string };

export interface AnalyticsProvider {
  readonly name: string;
  /** Synchronous, before hydration: anything that must precede the provider's script. */
  bootstrap?(settings: PublicProviderSettings, context: BootstrapContext): void;
  initialize(settings: PublicProviderSettings, context: AnalyticsContext): void;
  track(event: DispatchEvent, context: AnalyticsContext): DispatchResult | Promise<DispatchResult>;
  /** Called instead of `track` for `page_view` triggers, when present. */
  page?(event: DispatchEvent, context: AnalyticsContext): DispatchResult | Promise<DispatchResult>;
  /** A change after load. The gate has already decided `context.permitted`. */
  updateConsent?(context: AnalyticsContext): void;
  isAvailable(): boolean;
}

export type ProviderFactory = () => AnalyticsProvider;

export type CspSources = {
  script?: readonly string[];
  img?: readonly string[];
  connect?: readonly string[];
  frame?: readonly string[];
};

/** A provider's settings as stored in the Analytics Settings global. */
export type StoredProviderSettings = Readonly<Record<string, unknown>>;

export interface ProviderDefinition {
  /** Lowercase letters and digits; also the settings tab's field name. */
  readonly id: string;
  readonly label: string;
  /** A line at the top of its settings tab, such as where a value it uses is set. */
  readonly description?: string;
  /** Settings fields, beyond the common enabled / debug / consent trio. */
  readonly fields: Field[];
  /** The requirement a new install starts with. */
  readonly defaultConsent: ConsentRequirement;
  readonly csp: CspSources;
  /**
   * Values the host keeps outside these settings, read with them and handed to `project()` as
   * `supplied`. A rejection switches off this provider alone.
   */
  supply?(): Promise<StoredProviderSettings>;
  /**
   * The public projection of this provider's settings, or a reason it stays off. Only
   * values this function copies across ever reach the browser.
   */
  project(
    stored: StoredProviderSettings,
    environment: Environment,
    supplied?: StoredProviderSettings,
  ): { options: Record<string, ParameterValue> } | { off: string };
  /** A destination-specific rule for event names, such as a length limit. */
  validateEventName?(name: string): true | string;
  /**
   * Checked on save, with every provider's stored settings, for rules that span providers. While
   * it is enabled, `supplied` is what `supply()` returned, or null if that failed.
   */
  validateSettings?(
    own: StoredProviderSettings,
    all: Readonly<Record<string, StoredProviderSettings>>,
    supplied?: StoredProviderSettings | null,
  ): true | string;
}
