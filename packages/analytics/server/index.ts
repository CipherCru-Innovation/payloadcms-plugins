/**
 * The server side a public route may import: the projection and its cache. No Payload
 * import — the host supplies the reads.
 */
export {
  createConfigLoader,
  projectConfig,
  readSupplied,
  serializeConfig,
  type ConfigLoader,
  type ConfigSource,
  type Projection,
  type StoredAnalyticsEvent,
  type StoredAnalyticsSettings,
  type SuppliedValues,
} from "./config.js";
export {
  builtInProviders,
  ga4Provider,
  gtmProvider,
  hubspotPortal,
  hubspotPortalText,
  hubspotProvider,
  type HubSpotPortalSettings,
} from "../providers/definitions.js";
export { DEFAULT_SLUGS, type SettingsHooks } from "../plugin-options.js";
export type { Environment, PublicAnalyticsConfig } from "../core/types.js";
