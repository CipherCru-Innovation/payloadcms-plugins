import { ga4Provider } from "./ga4/config.js";
import { gtmProvider } from "./gtm/config.js";
import { hubspotPortal, hubspotPortalText, hubspotProvider, type HubSpotPortalSettings } from "./hubspot/config.js";
import type { ProviderDefinition } from "./types.js";

export { ga4Provider, gtmProvider, hubspotPortal, hubspotPortalText, hubspotProvider, type HubSpotPortalSettings };

/** The built-in destinations, in the order their settings tabs appear. */
export function builtInProviders(): readonly ProviderDefinition[] {
  return [gtmProvider, ga4Provider, hubspotProvider];
}
