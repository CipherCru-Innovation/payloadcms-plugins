import type { ParameterValue } from "../../core/types.js";
import { browserHost, injectScript, queue, type BrowserHost } from "../dom.js";
import type { AnalyticsProvider } from "../types.js";
import { HUBSPOT_PORTAL_ID, type HubSpotOptions } from "./types.js";

/**
 * HubSpot's tracking code. It is loaded only once the central gate permits it, with consent
 * already queued so the script reads it first. HubSpot counts the page it loads on itself,
 * so client-side navigations are sent as `setPath` + `trackPageView`, once per path.
 */

export const HUBSPOT_SCRIPT_ID = "hs-script-loader";

export function hubspotAdapter({ host = browserHost() }: { host?: BrowserHost | null } = {}): AnalyticsProvider {
  let options: HubSpotOptions | null = null;
  let permitted = false;
  let failed = false;
  let lastPath: string | null = null;

  const loaded = () => host !== null && host.document.getElementById(HUBSPOT_SCRIPT_ID) !== null;
  const tracker = () => queue<unknown[]>(host!, "_hsq");
  const privacy = () => queue<unknown[]>(host!, "_hsp");
  const read = (settings: { options: Readonly<Record<string, ParameterValue>> }) =>
    settings.options as unknown as HubSpotOptions;

  function load() {
    if (!host || !options || loaded()) return;
    if (options.disableCookieBanner) host.window.disableHubSpotCookieBanner = true;
    /* Before the script exists, so the queue is read in this order. */
    privacy().push(["setHubSpotConsent", { analytics: true, advertisement: false, functionality: false }]);
    injectScript(host, {
      id: HUBSPOT_SCRIPT_ID,
      src: `https://js.hs-scripts.com/${options.portalId}.js`,
      onError: () => {
        failed = true;
      },
    });
    lastPath = host.window.location.pathname;
  }

  return {
    name: "hubspot",
    isAvailable: () => host !== null && options !== null && !failed,
    initialize(settings, context) {
      /* The projection never publishes HubSpot without a portal; a hand-built config might. */
      const given = read(settings);
      options = HUBSPOT_PORTAL_ID.test(String(given.portalId ?? "")) ? given : null;
      permitted = context.permitted;
      if (permitted) load();
    },
    track(event) {
      if (!options?.eventForwarding) return { skipped: "event forwarding is off" };
      if (!loaded()) return { skipped: "tracker not loaded" };
      tracker().push(["trackCustomBehavioralEvent", { name: event.name, properties: { ...event.params } }]);
    },
    page() {
      if (!loaded()) return { skipped: "tracker not loaded" };
      const path = host!.window.location.pathname;
      if (path === lastPath) return { skipped: "already counted by the tracker" };
      lastPath = path;
      tracker().push(["setPath", path]);
      tracker().push(["trackPageView"]);
    },
    updateConsent(context) {
      const was = permitted;
      permitted = context.permitted;
      if (permitted && !loaded()) load();
      /* Stops tracking and clears HubSpot's cookies. The script stays loaded. */
      if (was && !permitted && loaded()) privacy().push(["revokeCookieConsent"]);
    },
  };
}
