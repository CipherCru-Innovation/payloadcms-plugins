import type { DispatchReport } from "../core/dispatcher.js";
import type { EventPayload } from "../core/types.js";
import { installedAnalytics } from "./runtime.js";

/**
 * What application code calls. Reports what happened — `contact_form_submit`, not
 * `generate_lead` — and never learns where it went. A no-op until the runtime is installed.
 */
export function track(key: string, payload?: EventPayload): DispatchReport | undefined {
  return installedAnalytics()?.track(key, payload);
}

export const analytics = {
  track,
  page: (payload?: EventPayload) => installedAnalytics()?.page(payload),
} as const;
