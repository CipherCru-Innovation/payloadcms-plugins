/**
 * The plugin's shared vocabulary. Nothing here names a provider or a site: the registry,
 * the runtime and every adapter speak only these types.
 */

export const ENVIRONMENTS = ["development", "staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const TRIGGER_TYPES = [
  "page_view",
  "click",
  "form_submit",
  "download",
  "outbound_link",
  "scroll",
  "custom",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const CONSENT_CATEGORIES = ["analytics", "marketing"] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** What a destination needs before it may receive anything. */
export const CONSENT_REQUIREMENTS = ["none", ...CONSENT_CATEGORIES] as const;
export type ConsentRequirement = (typeof CONSENT_REQUIREMENTS)[number];

/**
 * The consent state every adapter is handed, normalised by the host from whatever banner
 * it runs. `decided` is false only while the visitor has not answered at all.
 */
export type ConsentState = {
  decided: boolean;
  analytics: boolean;
  marketing: boolean;
};

export const PARAMETER_TYPES = ["string", "number", "boolean"] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

/**
 * How a string parameter is guarded. `url` keeps a URL's shape and redacts email-like query
 * values; `title` is truncated rather than refused; `text` is refused when it looks personal.
 */
export const PARAMETER_FORMATS = ["text", "url", "title"] as const;
export type ParameterFormat = (typeof PARAMETER_FORMATS)[number];

export type ParameterValue = string | number | boolean;

/** What application code hands `track()`. Anything not declared is dropped or refused. */
export type EventPayload = Readonly<Record<string, unknown>>;

export type ParameterDefinition = {
  name: string;
  type: ParameterType;
  required: boolean;
  format: ParameterFormat;
  /** Characters; the guard's default applies when absent. */
  maxLength?: number;
  /** Cut an over-long value to `maxLength` instead of refusing it. */
  truncate: boolean;
};

export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "exists",
  "starts_with",
  "contains",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

/**
 * A declarative rule, never code. `field` names an event parameter or a context value
 * (`pagePath`, `environment`); `value` is ignored by `exists`.
 */
export type Condition = {
  field: string;
  operator: ConditionOperator;
  value?: string;
};

export type ParameterAlias = { parameter: string; alias: string };

export type ProviderMapping = {
  provider: string;
  enabled: boolean;
  /** The provider's own name for the event. */
  eventName: string;
  aliases: ParameterAlias[];
  /** Replaces the event's requirement for this destination only. */
  consent?: ConsentRequirement;
  conditions: Condition[];
};

export type EventDefinition = {
  key: string;
  triggerType: TriggerType;
  enabled: boolean;
  /** Empty means every environment. */
  environments: Environment[];
  consent: ConsentRequirement;
  parameters: ParameterDefinition[];
  mappings: ProviderMapping[];
};

/** A provider's settings as the browser receives them: public values only. */
export type PublicProviderSettings = {
  enabled: true;
  debug: boolean;
  consent: ConsentRequirement;
  options: Readonly<Record<string, ParameterValue>>;
};

export type UnknownParameterPolicy = "drop" | "reject";

/** Everything the browser learns about analytics, rendered once per page. */
export type PublicAnalyticsConfig = {
  version: 1;
  enabled: boolean;
  environment: Environment;
  debug: boolean;
  consent: {
    /** False switches the gate off: every destination counts as permitted. */
    required: boolean;
    /** How an undecided visitor is treated. */
    whenUndecided: "denied" | "granted";
  };
  unknownParameters: UnknownParameterPolicy;
  providers: Readonly<Record<string, PublicProviderSettings>>;
  events: readonly EventDefinition[];
};

export const PUBLIC_CONFIG_VERSION = 1;
