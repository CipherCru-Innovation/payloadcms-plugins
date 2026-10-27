import type { ConsentRequirement, ConsentState, PublicAnalyticsConfig } from "./types.js";

/**
 * The one consent gate. Adapters are told whether they are permitted; none reads a cookie
 * or decides for itself.
 */

export type ConsentPolicy = PublicAnalyticsConfig["consent"];

export const UNDECIDED: ConsentState = { decided: false, analytics: false, marketing: false };

export function isPermitted(requirement: ConsentRequirement, state: ConsentState, policy: ConsentPolicy): boolean {
  if (!policy.required || requirement === "none") return true;
  if (!state.decided) return policy.whenUndecided === "granted";
  return state[requirement];
}

/** A destination needs its event's (or mapping's) requirement and its provider's own. */
export function destinationPermitted(
  requirements: readonly ConsentRequirement[],
  state: ConsentState,
  policy: ConsentPolicy,
): { permitted: true } | { permitted: false; missing: ConsentRequirement } {
  for (const requirement of requirements) {
    if (!isPermitted(requirement, state, policy)) return { permitted: false, missing: requirement };
  }
  return { permitted: true };
}

export function sameConsent(a: ConsentState, b: ConsentState): boolean {
  return a.decided === b.decided && a.analytics === b.analytics && a.marketing === b.marketing;
}
