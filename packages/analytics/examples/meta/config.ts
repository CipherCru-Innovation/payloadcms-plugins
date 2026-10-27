import type { ProviderDefinition } from "../../providers/types.js";

/**
 * An example provider, the one the README's "Adding a provider" walks through: Meta Pixel.
 * Not registered by default. The server half: its settings fields, what of them is public,
 * and the hosts a CSP must allow.
 */
export const metaProvider: ProviderDefinition = {
  id: "meta",
  label: "Meta Pixel",
  defaultConsent: "marketing",
  csp: {
    script: ["https://connect.facebook.net"],
    img: ["https://www.facebook.com"],
    connect: ["https://www.facebook.com"],
  },
  fields: [
    {
      name: "pixelId",
      type: "text",
      label: "Pixel ID",
      admin: { description: "Public: rendered into every page." },
      validate: (value: unknown) => (!value || /^\d+$/.test(String(value)) ? true : "The pixel ID is digits only."),
    },
  ],
  project(stored) {
    const pixelId = typeof stored.pixelId === "string" ? stored.pixelId.trim() : "";
    return /^\d+$/.test(pixelId) ? { options: { pixelId } } : { off: "no valid pixel ID" };
  },
};
