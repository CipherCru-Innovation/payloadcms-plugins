import type { ProviderDefinition, StoredProviderSettings } from "../types.js";
import { HUBSPOT_CSP } from "./csp.js";
import { HUBSPOT_PORTAL_ID, type HubSpotOptions } from "./types.js";

type Sibling = { siblingData?: Record<string, unknown> };
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The settings a host hands the portal readers: the stored global, or nothing yet. */
export type HubSpotPortalSettings = { readonly hubspot?: unknown } | null | undefined;

/** The HubSpot tab's portal as stored, trimmed, and "" when there is none: what "blank" means. */
export function hubspotPortalText(settings: HubSpotPortalSettings): string {
  return text((settings?.hubspot as StoredProviderSettings | null | undefined)?.portalId);
}

/**
 * The portal (Hub ID) stored on the HubSpot tab, or null when it is blank or not digits. A host
 * that sends anything else to HubSpot, such as form submissions, reads it here, so the tracker
 * and the rest cannot name two accounts.
 */
export function hubspotPortal(settings: HubSpotPortalSettings): string | null {
  const portalId = hubspotPortalText(settings);
  return HUBSPOT_PORTAL_ID.test(portalId) ? portalId : null;
}

/**
 * HubSpot's tracking code. It loads only once its consent requirement is met, and page views
 * follow client-side navigation. Forms and CRM delivery are not this provider's concern.
 */
export const hubspotProvider: ProviderDefinition = {
  id: "hubspot",
  label: "HubSpot",
  defaultConsent: "analytics",
  csp: HUBSPOT_CSP,
  fields: [
    {
      name: "portalId",
      type: "text",
      label: "Portal (Hub ID)",
      admin: {
        description:
          "The HubSpot account, digits only. Everything this site sends to HubSpot uses it, so change " +
          "it only when moving to another account. Public: rendered into every page while HubSpot is on.",
        placeholder: "12345678",
      },
      validate: (value: unknown, { siblingData }: Sibling) => {
        const portalId = text(value);
        if (!portalId) return siblingData?.enabled ? "HubSpot cannot be switched on without its portal." : true;
        return HUBSPOT_PORTAL_ID.test(portalId) ? true : 'A Hub ID is digits only, such as "12345678".';
      },
    },
    {
      type: "row",
      fields: [
        {
          name: "eventForwarding",
          type: "checkbox",
          label: "Forward mapped events",
          defaultValue: false,
          admin: {
            description:
              "Sends HubSpot destinations as custom behavioural events. HubSpot records these only on " +
              "plans that include them; page views are sent either way.",
          },
        },
        {
          name: "disableCookieBanner",
          type: "checkbox",
          label: "Hide HubSpot's own cookie banner",
          defaultValue: true,
          admin: { description: "The site's consent banner is the one visitors answer." },
        },
      ],
    },
  ],
  validateEventName: (name) =>
    /^[a-z][a-z0-9_]{0,99}$/.test(name) ? true : "HubSpot event names are lowercase letters, digits and underscores.",
  project(stored) {
    const portalId = text(stored.portalId);
    if (!portalId) return { off: "no portal ID" };
    if (!HUBSPOT_PORTAL_ID.test(portalId)) return { off: "no valid portal ID" };
    const options: HubSpotOptions = {
      portalId,
      eventForwarding: stored.eventForwarding === true,
      disableCookieBanner: stored.disableCookieBanner !== false,
    };
    return { options };
  },
};
