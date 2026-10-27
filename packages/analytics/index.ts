/**
 * The Payload side of the plugin: server-only, because it imports Payload. Browser code
 * imports `./client`; a public route that needs the configuration imports `./server`.
 */
export { analyticsPlugin } from "./plugin.js";
export { DEFAULT_SLUGS, type AnalyticsPluginOptions, type SettingsHooks } from "./plugin-options.js";
export type { ProviderDefinition, AnalyticsProvider, CspSources } from "./providers/types.js";
export * from "./core/types.js";
export {
  builtInProviders,
  ga4Provider,
  gtmProvider,
  hubspotPortal,
  hubspotPortalText,
  hubspotProvider,
  type HubSpotPortalSettings,
} from "./providers/definitions.js";
