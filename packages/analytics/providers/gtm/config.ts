import type { ProviderDefinition } from "../types.js";
import { GTM_CSP } from "./csp.js";
import { DATA_LAYER_NAME, GTM_CONTAINER_ID, type GtmOptions } from "./types.js";

const PUBLIC = "Public: rendered into every page.";

type Sibling = { siblingData?: Record<string, unknown> };
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Google Tag Manager. The browser receives the container, its environment outside
 * production, and the `dataLayer` name; the tags inside the container are managed in GTM.
 */
export const gtmProvider: ProviderDefinition = {
  id: "gtm",
  label: "Google Tag Manager",
  defaultConsent: "none",
  csp: GTM_CSP,
  fields: [
    {
      name: "containerId",
      type: "text",
      label: "Container ID",
      admin: { description: `For example GTM-ABC1234. ${PUBLIC}`, placeholder: "GTM-XXXXXXX" },
      validate: (value: unknown, { siblingData }: Sibling) => {
        const id = text(value);
        if (!id) return siblingData?.enabled ? "An enabled container needs its ID." : true;
        return GTM_CONTAINER_ID.test(id) ? true : "A container ID looks like GTM-ABC1234.";
      },
    },
    {
      type: "row",
      fields: [
        {
          name: "auth",
          type: "text",
          label: "Environment gtm_auth",
          admin: { description: `From the environment's snippet. Never sent on production. ${PUBLIC}` },
          validate: (value: unknown, { siblingData }: Sibling) =>
            Boolean(text(value)) === Boolean(text(siblingData?.preview))
              ? true
              : "gtm_auth and gtm_preview are a pair: set both or neither.",
        },
        {
          name: "preview",
          type: "text",
          label: "Environment gtm_preview",
          admin: { description: `For example env-3. ${PUBLIC}` },
        },
      ],
    },
    {
      name: "requireEnvironmentOutsideProduction",
      type: "checkbox",
      label: "Outside production, load the container only with an environment",
      defaultValue: true,
      admin: {
        description:
          "Keeps development and staging traffic out of the live container: without gtm_auth and " +
          "gtm_preview the container is not loaded there at all.",
      },
    },
    {
      type: "row",
      fields: [
        {
          name: "dataLayerName",
          type: "text",
          label: "dataLayer name",
          defaultValue: "dataLayer",
          validate: (value: unknown) =>
            !text(value) || DATA_LAYER_NAME.test(text(value)) ? true : "A JavaScript identifier, e.g. dataLayer.",
        },
        {
          name: "adsDataRedaction",
          type: "checkbox",
          label: "Redact ad identifiers while ad storage is denied",
          defaultValue: true,
        },
      ],
    },
  ],
  project(stored, environment) {
    const containerId = text(stored.containerId);
    if (!GTM_CONTAINER_ID.test(containerId)) return { off: "no valid container ID" };

    const auth = text(stored.auth);
    const preview = text(stored.preview);
    const hasEnvironment = Boolean(auth && preview) && environment !== "production";
    if (environment !== "production" && stored.requireEnvironmentOutsideProduction !== false && !hasEnvironment) {
      return { off: `no GTM environment set for ${environment}` };
    }

    const name = text(stored.dataLayerName);
    const options: GtmOptions = {
      containerId,
      dataLayerName: DATA_LAYER_NAME.test(name) ? name : "dataLayer",
      adsDataRedaction: stored.adsDataRedaction !== false,
      ...(hasEnvironment ? { auth, preview } : {}),
    };
    return { options };
  },
};
