import { browserHost, injectScript, type BrowserHost } from "../../providers/dom.js";
import type { AnalyticsProvider } from "../../providers/types.js";

type Fbq = ((...args: unknown[]) => void) & { queue?: unknown[][] };

/**
 * The browser half of the example provider. Loads the pixel only once the central gate
 * permits it, and sends each mapped event as `fbq("trackCustom", name, params)`.
 */
export function metaAdapter({ host = browserHost() }: { host?: BrowserHost | null } = {}): AnalyticsProvider {
  let pixelId = "";

  const fbq = (): Fbq => {
    const existing = host!.window.fbq as Fbq | undefined;
    if (existing) return existing;
    const queued: Fbq = (...args: unknown[]) => {
      queued.queue!.push(args);
    };
    queued.queue = [];
    host!.window.fbq = queued;
    return queued;
  };

  function load() {
    if (!host || !pixelId) return;
    if (injectScript(host, { id: "meta-pixel", src: "https://connect.facebook.net/en_US/fbevents.js" })) {
      fbq()("init", pixelId);
    }
  }

  return {
    name: "meta",
    isAvailable: () => host !== null && pixelId !== "",
    initialize(settings, context) {
      pixelId = String(settings.options.pixelId ?? "");
      if (context.permitted) load();
    },
    track(event) {
      fbq()("trackCustom", event.name, { ...event.params });
    },
    page() {
      fbq()("track", "PageView");
    },
    updateConsent(context) {
      if (context.permitted) load();
    },
  };
}
