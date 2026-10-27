import type { ParameterValue } from "../../core/types.js";
import { browserHost, injectScript, queue, type BrowserHost } from "../dom.js";
import type { AnalyticsProvider, AnalyticsContext } from "../types.js";
import type { GtmOptions } from "./types.js";

/**
 * Google Tag Manager. Events become `dataLayer` pushes; consent becomes Google Consent Mode
 * commands, which GTM reads only from an `arguments` object — an array is silently ignored.
 * This file is the only place in the plugin that writes to the dataLayer.
 */

export const GTM_SCRIPT_ID = "google-tag-manager";

type ConsentValue = "granted" | "denied";

const storage = (granted: boolean): ConsentValue => (granted ? "granted" : "denied");

export function containerUrl(options: GtmOptions): string {
  const query = new URLSearchParams({ id: options.containerId });
  if (options.dataLayerName !== "dataLayer") query.set("l", options.dataLayerName);
  if (options.auth && options.preview) {
    query.set("gtm_auth", options.auth);
    query.set("gtm_preview", options.preview);
    query.set("gtm_cookies_win", "x");
  }
  return `https://www.googletagmanager.com/gtm.js?${query.toString()}`;
}

export function gtmAdapter({ host = browserHost(), now = Date.now }: { host?: BrowserHost | null; now?: () => number } = {}): AnalyticsProvider {
  let options: GtmOptions | null = null;
  let bootstrapped = false;
  let lastAnalyticsStorage: boolean | null = null;

  const layer = () => queue(host!, options?.dataLayerName ?? "dataLayer");

  /* gtag's own shape: `arguments`, never rest parameters. */
  function gtag(...args: unknown[]): void {
    void args;
    // eslint-disable-next-line prefer-rest-params
    layer().push(arguments);
  }

  const read = (settings: { options: Readonly<Record<string, ParameterValue>> }) =>
    settings.options as unknown as GtmOptions;

  function pushDefault(context: AnalyticsContext, globals: Readonly<Record<string, ParameterValue>>) {
    if (bootstrapped) return;
    bootstrapped = true;
    const granted = context.consent.decided && context.consent.analytics;
    lastAnalyticsStorage = granted;
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: storage(granted),
      /* Only while an answer is outstanding: a stored choice is the answer. */
      ...(context.consent.decided ? {} : { wait_for_update: 500 }),
    });
    if (options!.adsDataRedaction) gtag("set", { ads_data_redaction: true });
    if (Object.keys(globals).length > 0) gtag("set", { ...globals });
    /* What GTM's own snippet pushes before the container loads. */
    layer().push({ "gtm.start": now(), event: "gtm.js" });
  }

  return {
    name: "gtm",
    isAvailable: () => host !== null && options !== null,
    bootstrap(settings, context) {
      if (!host) return;
      options = read(settings);
      pushDefault(context, context.globals);
    },
    initialize(settings, context) {
      if (!host) return;
      options = read(settings);
      /* Normally done before hydration; this keeps the default ahead of gtm.js regardless. */
      pushDefault(context, {});
      injectScript(host, { id: GTM_SCRIPT_ID, src: containerUrl(options) });
    },
    track(event) {
      layer().push({ event: event.name, ...event.params });
    },
    page(event) {
      layer().push({ event: event.name, ...event.params });
    },
    updateConsent(context) {
      if (!host || !options) return;
      const granted = context.consent.decided && context.consent.analytics;
      if (granted === lastAnalyticsStorage) return;
      lastAnalyticsStorage = granted;
      gtag("consent", "update", { analytics_storage: storage(granted) });
    },
  };
}
