import type { DispatchReport } from "../core/dispatcher.js";
import type { EventPayload } from "../core/types.js";
import { installedAnalytics } from "./runtime.js";

/**
 * One `page_view` per settled navigation. The host decides when a page has settled — after
 * Next commits the new title, say — and calls this once; a repeat for the same URL and the
 * same payload within one navigation is dropped, so a double effect cannot count twice.
 */

let last: { url: string; payload: string } | null = null;

export function pageView(payload: EventPayload = {}): DispatchReport | undefined {
  const url = typeof window === "undefined" ? "" : window.location.href;
  const signature = JSON.stringify(payload);
  if (last && last.url === url && last.payload === signature) return undefined;
  last = { url, payload: signature };
  return installedAnalytics()?.page(payload);
}

/** For tests, and for a host that must deliberately re-send the current page. */
export function forgetLastPageView(): void {
  last = null;
}
