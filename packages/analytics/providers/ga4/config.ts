import type { ProviderDefinition } from "../types.js";
import { GA4_CSP } from "./csp.js";
import { GA4_EVENT_NAME, GA4_MEASUREMENT_ID, GA4_RESERVED_PREFIXES, type Ga4Options } from "./types.js";

const PUBLIC = "Public: rendered into every page.";
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Google Analytics 4. `via_gtm` means the GTM container runs the GA4 tags, and this provider
 * then sends nothing itself: one delivery path per event is what keeps GA4 free of duplicates.
 */
export const ga4Provider: ProviderDefinition = {
  id: "ga4",
  label: "Google Analytics 4",
  defaultConsent: "none",
  csp: GA4_CSP,
  fields: [
    {
      type: "row",
      fields: [
        {
          name: "deliveryMode",
          type: "select",
          label: "Delivery",
          defaultValue: "via_gtm",
          required: true,
          options: [
            { value: "via_gtm", label: "Through the GTM container" },
            { value: "direct", label: "Directly, with gtag.js" },
          ],
          admin: {
            description:
              "Through GTM: GA4 events are GTM's to send, and this provider sends nothing. " +
              "Directly: only while Google Tag Manager is off, so no event can reach GA4 twice.",
          },
        },
        {
          name: "measurementId",
          type: "text",
          label: "Measurement ID",
          admin: { description: `For example G-ABC123XYZ. ${PUBLIC}`, placeholder: "G-XXXXXXXXXX" },
          validate: (value: unknown, { siblingData }: { siblingData?: Record<string, unknown> }) => {
            const id = text(value);
            if (!id) {
              return siblingData?.enabled && siblingData?.deliveryMode === "direct"
                ? "Direct delivery needs the measurement ID."
                : true;
            }
            return GA4_MEASUREMENT_ID.test(id) ? true : "A measurement ID looks like G-ABC123XYZ.";
          },
        },
      ],
    },
    {
      name: "sendPageViews",
      type: "checkbox",
      label: "Send page views",
      defaultValue: true,
      admin: { description: "Direct delivery only. GA4's own automatic page view stays off either way." },
    },
  ],
  validateEventName(name) {
    if (!GA4_EVENT_NAME.test(name)) return "GA4 event names are letters, digits and underscores, at most 40 characters.";
    const prefix = GA4_RESERVED_PREFIXES.find((reserved) => name.startsWith(reserved));
    return prefix ? `GA4 reserves the "${prefix}" prefix.` : true;
  },
  validateSettings(own, all) {
    if (own.enabled === true && own.deliveryMode !== "direct" && all.gtm?.enabled !== true) {
      return "GA4 through GTM needs Google Tag Manager enabled, or nothing reaches GA4.";
    }
    /* The plugin cannot see inside the container, so it cannot prove GTM runs no GA4 tag. */
    if (own.enabled === true && own.deliveryMode === "direct" && all.gtm?.enabled === true) {
      return "GA4 cannot be sent directly while Google Tag Manager is on: send it through GTM, so each event reaches GA4 once.";
    }
    return true;
  },
  project(stored) {
    const sendPageViews = stored.sendPageViews !== false;
    if (stored.deliveryMode !== "direct") {
      const options: Ga4Options = { deliveryMode: "via_gtm", sendPageViews };
      return { options };
    }
    const measurementId = text(stored.measurementId);
    if (!GA4_MEASUREMENT_ID.test(measurementId)) return { off: "direct delivery without a valid measurement ID" };
    const options: Ga4Options = { deliveryMode: "direct", measurementId, sendPageViews };
    return { options };
  },
};
