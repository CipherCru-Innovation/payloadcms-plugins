import { GA4_CSP } from "./providers/ga4/csp.js";
import { GTM_CSP } from "./providers/gtm/csp.js";
import { HUBSPOT_CSP } from "./providers/hubspot/csp.js";
import type { CspSources } from "./providers/types.js";

/**
 * The hosts a Content Security Policy must allow for the built-in providers. Plain data with
 * no Payload or browser import, so a Next config can read it. Which providers the CMS has
 * switched on is decided at runtime, so a host that builds its policy once includes them all.
 */
export const PROVIDER_CSP: Readonly<Record<string, CspSources>> = {
  ga4: GA4_CSP,
  gtm: GTM_CSP,
  hubspot: HUBSPOT_CSP,
};

export type CspDirective = keyof CspSources;

/** Every host each directive needs, de-duplicated, in first-seen order. */
export function analyticsCspSources(
  providers: readonly CspSources[] = Object.values(PROVIDER_CSP),
): Record<CspDirective, string[]> {
  const merged: Record<CspDirective, string[]> = { script: [], img: [], connect: [], frame: [] };
  for (const sources of providers) {
    for (const directive of Object.keys(merged) as CspDirective[]) {
      for (const host of sources[directive] ?? []) {
        if (!merged[directive].includes(host)) merged[directive].push(host);
      }
    }
  }
  return merged;
}
