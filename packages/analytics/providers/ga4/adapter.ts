import type { ParameterValue } from "../../core/types.js";
import { browserHost, injectScript, queue, type BrowserHost } from "../dom.js";
import type { AnalyticsContext, AnalyticsProvider } from "../types.js";
import type { Ga4Options } from "./types.js";

/**
 * Google Analytics 4. Through GTM (the default) this adapter sends nothing — the container's
 * GA4 tags do — and says so in the debug trace. Directly, it loads gtag.js and sends each
 * mapped event as a gtag `event` command. Never both, or GA4 counts every event twice.
 */

export const GA4_SCRIPT_ID = "google-analytics-gtag";
const VIA_GTM = { skipped: "delivered by GTM" } as const;

export function ga4Adapter({ host = browserHost(), now = () => new Date() }: { host?: BrowserHost | null; now?: () => Date } = {}): AnalyticsProvider {
  let options: Ga4Options | null = null;
  let bootstrapped = false;
  let lastAnalyticsStorage: boolean | null = null;

  function gtag(...args: unknown[]): void {
    void args;
    // eslint-disable-next-line prefer-rest-params
    queue(host!, "dataLayer").push(arguments);
  }

  const direct = () => options?.deliveryMode === "direct" && Boolean(options.measurementId);
  const read = (settings: { options: Readonly<Record<string, ParameterValue>> }) =>
    settings.options as unknown as Ga4Options;

  function configure(context: AnalyticsContext, globals: Readonly<Record<string, ParameterValue>>) {
    if (bootstrapped || !direct()) return;
    bootstrapped = true;
    const granted = context.consent.decided && context.consent.analytics;
    lastAnalyticsStorage = granted;
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: granted ? "granted" : "denied",
      ...(context.consent.decided ? {} : { wait_for_update: 500 }),
    });
    if (Object.keys(globals).length > 0) gtag("set", { ...globals });
    gtag("js", now());
    /* Page views are sent by the runtime on navigation, so GA4's automatic one stays off. */
    gtag("config", options!.measurementId, { send_page_view: false, ...(context.debug ? { debug_mode: true } : {}) });
  }

  return {
    name: "ga4",
    isAvailable: () => host !== null && options !== null,
    bootstrap(settings, context) {
      if (!host) return;
      options = read(settings);
      configure(context, context.globals);
    },
    initialize(settings, context) {
      if (!host) return;
      options = read(settings);
      if (!direct()) return;
      configure(context, {});
      injectScript(host, {
        id: GA4_SCRIPT_ID,
        src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(options.measurementId!)}`,
      });
    },
    track(event, context) {
      if (!direct()) return VIA_GTM;
      gtag("event", event.name, { ...event.params, ...(context.debug ? { debug_mode: true } : {}) });
    },
    page(event, context) {
      if (!direct()) return VIA_GTM;
      if (!options!.sendPageViews) return { skipped: "page views are off" };
      gtag("event", event.name, { ...event.params, ...(context.debug ? { debug_mode: true } : {}) });
    },
    updateConsent(context) {
      if (!direct()) return;
      const granted = context.consent.decided && context.consent.analytics;
      if (granted === lastAnalyticsStorage) return;
      lastAnalyticsStorage = granted;
      gtag("consent", "update", { analytics_storage: granted ? "granted" : "denied" });
    },
  };
}
