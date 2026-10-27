import type { CspSources } from "../types.js";

/**
 * gtag.js, and GA4 collection, which goes to region-specific hosts, hence the wildcards. A
 * container that runs GA4 tags needs the same collection hosts.
 */
export const GA4_CSP: CspSources = {
  script: ["https://www.googletagmanager.com"],
  img: ["https://*.google-analytics.com", "https://www.googletagmanager.com"],
  connect: ["https://*.google-analytics.com", "https://*.analytics.google.com", "https://www.googletagmanager.com"],
};
