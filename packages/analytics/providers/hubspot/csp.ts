import type { CspSources } from "../types.js";

/**
 * The tracker (hs-scripts, hs-analytics) and the host that reads the `_hsp` consent queue
 * (hs-banner). Wildcards because HubSpot serves each portal from its region, redirecting
 * `js.hs-scripts.com` to e.g. `js-na2.hs-scripts.com`; a pinned host fails silently.
 */
export const HUBSPOT_CSP: CspSources = {
  script: ["https://*.hs-scripts.com", "https://*.hs-analytics.net", "https://*.hs-banner.com"],
  img: ["https://*.hubspot.com"],
  connect: ["https://*.hubspot.com"],
};
