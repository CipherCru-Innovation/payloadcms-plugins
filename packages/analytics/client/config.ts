import { PUBLIC_CONFIG_VERSION, type PublicAnalyticsConfig } from "../core/types.js";

/** The element the server renders the public configuration into. */
export const CONFIG_ELEMENT_ID = "analytics-config";

/**
 * Reads the configuration the server rendered into the page, synchronously, so it can run
 * before hydration. Null when absent, unreadable, or of a version this runtime does not know.
 */
export function readConfig(id: string = CONFIG_ELEMENT_ID): PublicAnalyticsConfig | null {
  if (typeof document === "undefined") return null;
  try {
    const text = document.getElementById(id)?.textContent;
    if (!text) return null;
    const parsed = JSON.parse(text) as Partial<PublicAnalyticsConfig>;
    if (parsed?.version !== PUBLIC_CONFIG_VERSION || !Array.isArray(parsed.events) || typeof parsed.providers !== "object") {
      return null;
    }
    return parsed as PublicAnalyticsConfig;
  } catch {
    return null;
  }
}
