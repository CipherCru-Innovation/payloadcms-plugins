import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAnalyticsRuntime } from "../client/runtime.js";
import { ga4Provider } from "../providers/ga4/config.js";
import { ga4Adapter, GA4_SCRIPT_ID } from "../providers/ga4/adapter.js";
import { gtmProvider } from "../providers/gtm/config.js";
import { projectConfig } from "../server/config.js";
import { builtInProviders } from "../providers/definitions.js";
import { containerUrl, gtmAdapter, GTM_SCRIPT_ID } from "../providers/gtm/adapter.js";
import { hubspotProvider } from "../providers/hubspot/config.js";
import { hubspotAdapter, HUBSPOT_SCRIPT_ID } from "../providers/hubspot/adapter.js";
import type { DispatchEvent } from "../providers/types.js";
import { config, context, DENIED, event, fakeHost, GRANTED, provider, UNDECIDED } from "./support.js";

/* Each adapter against a stub browser; nothing leaves the process. */

/** An `arguments` object and an array look alike to deepEqual; GTM treats them differently. */
const kind = (entry: unknown) => (Array.isArray(entry) ? "array" : Object.prototype.toString.call(entry));
const args = (entry: unknown) => Array.from(entry as ArrayLike<unknown>);

const leadEvent: DispatchEvent = { key: "contact_form_submit", name: "generate_lead", triggerType: "form_submit", params: { form_location: "footer" } };

const gtmSettings = (options: Record<string, string | boolean> = {}) =>
  provider({ options: { containerId: "GTM-ABC1234", dataLayerName: "dataLayer", adsDataRedaction: true, ...options } });

describe("the GTM adapter", () => {
  it("pushes the consent default as an arguments object, then gtm.start, before the container loads", () => {
    const host = fakeHost();
    const adapter = gtmAdapter({ host, now: () => 42 });
    adapter.bootstrap!(gtmSettings(), { ...context({ consent: UNDECIDED }), globals: { traffic_type: "internal" } });
    const layer = host.window.dataLayer as unknown[];
    assert.deepEqual(layer.map(kind), ["[object Arguments]", "[object Arguments]", "[object Arguments]", "[object Object]"]);
    assert.deepEqual(args(layer[0]), [
      "consent",
      "default",
      { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied", wait_for_update: 500 },
    ]);
    assert.deepEqual(args(layer[1]), ["set", { ads_data_redaction: true }]);
    assert.deepEqual(args(layer[2]), ["set", { traffic_type: "internal" }]);
    assert.deepEqual(layer[3], { "gtm.start": 42, event: "gtm.js" });
    assert.equal(host.scripts.length, 0);
  });

  it("loads the container once, with the environment and a custom dataLayer name", () => {
    const host = fakeHost();
    const adapter = gtmAdapter({ host });
    const settings = gtmSettings({ dataLayerName: "tagQueue", auth: "abc", preview: "env-3" });
    adapter.initialize(settings, context());
    adapter.initialize(settings, context());
    assert.equal(host.scripts.length, 1);
    assert.equal(host.scripts[0]!.id, GTM_SCRIPT_ID);
    assert.equal(host.scripts[0]!.src, "https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234&l=tagQueue&gtm_auth=abc&gtm_preview=env-3&gtm_cookies_win=x");
    assert.equal((host.window.tagQueue as unknown[]).length, 3, "default, redaction and gtm.start, once");
    assert.equal(host.window.dataLayer, undefined);
  });

  it("pushes an event with its parameters as a plain object", () => {
    const host = fakeHost();
    const adapter = gtmAdapter({ host });
    adapter.initialize(gtmSettings(), context());
    adapter.track(leadEvent, context());
    assert.deepEqual((host.window.dataLayer as unknown[]).at(-1), { event: "generate_lead", form_location: "footer" });
  });

  it("sends a consent update only when analytics storage actually changes", () => {
    const host = fakeHost();
    const adapter = gtmAdapter({ host });
    adapter.bootstrap!(gtmSettings(), { ...context({ consent: UNDECIDED }), globals: {} });
    const before = (host.window.dataLayer as unknown[]).length;
    adapter.updateConsent!(context({ consent: DENIED }));
    assert.equal((host.window.dataLayer as unknown[]).length, before, "undecided to denied is no change to storage");
    adapter.updateConsent!(context({ consent: GRANTED }));
    const layer = host.window.dataLayer as unknown[];
    assert.equal(kind(layer.at(-1)), "[object Arguments]");
    assert.deepEqual(args(layer.at(-1)), ["consent", "update", { analytics_storage: "granted" }]);
  });

  it("is unavailable, and sends nothing, when disabled by the CMS", () => {
    const host = fakeHost();
    const runtime = createAnalyticsRuntime({ config: config({ providers: {}, events: [event({ mappings: [{ provider: "gtm", enabled: true, eventName: "x", aliases: [], conditions: [] }] })] }), providers: [gtmAdapter({ host })] });
    runtime.start();
    runtime.track("contact_form_submit", {});
    assert.equal(host.window.dataLayer, undefined);
    assert.equal(host.scripts.length, 0);
  });

  it("projects a container only with a valid ID, and outside production only with an environment", () => {
    assert.deepEqual(gtmProvider.project({ containerId: "nope" }, "production"), { off: "no valid container ID" });
    assert.deepEqual(gtmProvider.project({ containerId: "GTM-A1" }, "staging"), { off: "no GTM environment set for staging" });
    assert.ok("options" in gtmProvider.project({ containerId: "GTM-A1", auth: "a", preview: "p" }, "staging"));
    assert.ok("options" in gtmProvider.project({ containerId: "GTM-A1", requireEnvironmentOutsideProduction: false }, "development"));
    assert.equal(containerUrl({ containerId: "GTM-A1", dataLayerName: "dataLayer", adsDataRedaction: true }), "https://www.googletagmanager.com/gtm.js?id=GTM-A1");
  });
});

describe("the GA4 adapter", () => {
  const direct = (options: Record<string, string | boolean> = {}) =>
    provider({ options: { deliveryMode: "direct", measurementId: "G-ABC123", sendPageViews: true, ...options } });

  it("through GTM, sends nothing and says why, so GA4 never counts an event twice", () => {
    const host = fakeHost();
    const adapter = ga4Adapter({ host });
    adapter.initialize(provider({ options: { deliveryMode: "via_gtm", sendPageViews: true } }), context());
    assert.deepEqual(adapter.track(leadEvent, context()), { skipped: "delivered by GTM" });
    assert.deepEqual(adapter.page!({ ...leadEvent, name: "page_view" }, context()), { skipped: "delivered by GTM" });
    assert.equal(host.window.dataLayer, undefined);
    assert.equal(host.scripts.length, 0);
  });

  it("directly, loads gtag.js once and configures it without GA4's own page view", () => {
    const host = fakeHost();
    const adapter = ga4Adapter({ host, now: () => new Date(0) });
    adapter.initialize(direct(), context({ consent: GRANTED, debug: true }));
    adapter.initialize(direct(), context());
    assert.equal(host.scripts.length, 1);
    assert.equal(host.scripts[0]!.id, GA4_SCRIPT_ID);
    assert.equal(host.scripts[0]!.src, "https://www.googletagmanager.com/gtag/js?id=G-ABC123");
    const layer = (host.window.dataLayer as unknown[]).map(args);
    assert.deepEqual(layer.map((entry) => entry[0]), ["consent", "js", "config"]);
    assert.deepEqual(layer[2], ["config", "G-ABC123", { send_page_view: false, debug_mode: true }]);
  });

  it("sends a standard and a custom event with their parameters", () => {
    const host = fakeHost();
    const adapter = ga4Adapter({ host });
    adapter.initialize(direct(), context());
    adapter.track(leadEvent, context());
    adapter.track({ ...leadEvent, name: "brochure_open", params: { file: "a.pdf" } }, context());
    const layer = (host.window.dataLayer as unknown[]).map(args);
    assert.deepEqual(layer.at(-2), ["event", "generate_lead", { form_location: "footer" }]);
    assert.deepEqual(layer.at(-1), ["event", "brochure_open", { file: "a.pdf" }]);
  });

  it("sends page views only when they are on", () => {
    const host = fakeHost();
    const adapter = ga4Adapter({ host });
    adapter.initialize(direct({ sendPageViews: false }), context());
    assert.deepEqual(adapter.page!({ ...leadEvent, name: "page_view" }, context()), { skipped: "page views are off" });
  });

  it("sends a page view directly, with debug_mode when debugging", () => {
    const host = fakeHost();
    const adapter = ga4Adapter({ host });
    adapter.initialize(direct(), context());
    adapter.page!({ ...leadEvent, key: "page_view", name: "page_view", triggerType: "page_view", params: { page_title: "Home" } }, context({ debug: true }));
    assert.deepEqual((host.window.dataLayer as unknown[]).map(args).at(-1), ["event", "page_view", { page_title: "Home", debug_mode: true }]);
  });

  it("is unavailable, and loads nothing, when disabled by the CMS", () => {
    const host = fakeHost();
    const runtime = createAnalyticsRuntime({
      config: config({ providers: {}, events: [event({ mappings: [{ provider: "ga4", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] }] })] }),
      providers: [ga4Adapter({ host })],
      consent: GRANTED,
    });
    runtime.start();
    const report = runtime.track("contact_form_submit", {})!;
    assert.equal(report.providers[0]!.reason, "provider disabled");
    assert.equal(host.window.dataLayer, undefined);
    assert.equal(host.scripts.length, 0);
  });

  it("stays off end to end when the stored measurement ID is invalid", () => {
    const { config: projected, skipped } = projectConfig({
      settings: { enabled: true, environments: ["production"], ga4: { enabled: true, deliveryMode: "direct", measurementId: "UA-123-1" } },
      events: [{ eventKey: "contact_form_submit", triggerType: "form_submit", enabled: true, mappings: [{ provider: "ga4", enabled: true, eventName: "generate_lead" }] }],
      providers: builtInProviders(),
      environment: "production",
    });
    assert.equal(skipped.ga4, "direct delivery without a valid measurement ID");
    const host = fakeHost();
    const runtime = createAnalyticsRuntime({ config: projected, providers: [ga4Adapter({ host })], consent: GRANTED });
    runtime.start();
    runtime.track("contact_form_submit", {});
    assert.equal(host.scripts.length, 0);
    assert.equal(host.window.dataLayer, undefined);
  });

  it("sends in parallel with HubSpot, each under its own name", () => {
    const host = fakeHost();
    const hubspot = provider({ consent: "analytics", options: { portalId: "123", eventForwarding: true, disableCookieBanner: true } });
    const runtime = createAnalyticsRuntime({
      config: config({
        providers: { ga4: direct(), hubspot },
        events: [event({ mappings: [
          { provider: "ga4", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] },
          { provider: "hubspot", enabled: true, eventName: "contact_form_submission", aliases: [], conditions: [] },
        ] })],
      }),
      providers: [ga4Adapter({ host }), hubspotAdapter({ host })],
      consent: GRANTED,
    });
    runtime.start();
    const report = runtime.track("contact_form_submit", { form_location: "footer" })!;
    assert.deepEqual(report.providers.map((p) => [p.provider, p.status]), [["ga4", "sent"], ["hubspot", "sent"]]);
    assert.deepEqual((host.window.dataLayer as unknown[]).map(args).at(-1), ["event", "generate_lead", { form_location: "footer" }]);
    assert.deepEqual((host.window._hsq as unknown[]).at(-1), ["trackCustomBehavioralEvent", { name: "contact_form_submission", properties: { form_location: "footer" } }]);
  });

  it("refuses an invalid measurement ID and a direct setup without one", () => {
    assert.deepEqual(ga4Provider.project({ deliveryMode: "direct", measurementId: "UA-1" }, "production"), { off: "direct delivery without a valid measurement ID" });
    assert.equal(ga4Provider.validateEventName!("x".repeat(41)), "GA4 event names are letters, digits and underscores, at most 40 characters.");
    assert.match(String(ga4Provider.validateEventName!("google_thing")), /reserves/);
    assert.match(String(ga4Provider.validateSettings!({ enabled: true, deliveryMode: "via_gtm" }, { gtm: { enabled: false } })), /needs Google Tag Manager/);
    assert.match(String(ga4Provider.validateSettings!({ enabled: true, deliveryMode: "direct" }, { gtm: { enabled: true } })), /cannot be sent directly while Google Tag Manager is on/);
    assert.equal(ga4Provider.validateSettings!({ enabled: true, deliveryMode: "direct" }, { gtm: { enabled: false } }), true);
  });

  it("is never reached when the central gate denies consent", () => {
    const host = fakeHost();
    const runtime = createAnalyticsRuntime({
      config: config({ providers: { ga4: direct({}) && provider({ consent: "analytics", options: direct().options }) }, events: [event({ consent: "analytics", mappings: [{ provider: "ga4", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] }] })] }),
      providers: [ga4Adapter({ host })],
      consent: DENIED,
    });
    runtime.start();
    const before = (host.window.dataLayer as unknown[]).length;
    const report = runtime.track("contact_form_submit", {})!;
    assert.equal(report.providers[0]!.reason, "analytics consent not given");
    assert.equal((host.window.dataLayer as unknown[]).length, before);
  });
});

describe("the HubSpot adapter", () => {
  const settings = (options: Record<string, string | boolean> = {}) =>
    provider({ consent: "analytics", options: { portalId: "123", eventForwarding: true, disableCookieBanner: true, ...options } });

  it("loads the tracker only once permitted, with consent queued first", () => {
    const host = fakeHost("/services");
    const adapter = hubspotAdapter({ host });
    adapter.initialize(settings(), context({ permitted: false }));
    assert.equal(host.scripts.length, 0);
    adapter.updateConsent!(context({ permitted: true }));
    assert.equal(host.scripts[0]!.id, HUBSPOT_SCRIPT_ID);
    assert.equal(host.scripts[0]!.src, "https://js.hs-scripts.com/123.js");
    assert.deepEqual(host.window._hsp, [["setHubSpotConsent", { analytics: true, advertisement: false, functionality: false }]]);
    assert.equal(host.window.disableHubSpotCookieBanner, true);
  });

  it("revokes on withdrawal, and never twice", () => {
    const host = fakeHost();
    const adapter = hubspotAdapter({ host });
    adapter.initialize(settings(), context({ permitted: true }));
    adapter.updateConsent!(context({ permitted: false }));
    adapter.updateConsent!(context({ permitted: false }));
    assert.deepEqual((host.window._hsp as unknown[]).at(-1), ["revokeCookieConsent"]);
    assert.equal((host.window._hsp as unknown[]).length, 2);
  });

  it("counts a client-side navigation once, and not the page the tracker loaded on", () => {
    const host = fakeHost("/");
    const adapter = hubspotAdapter({ host });
    adapter.initialize(settings(), context({ permitted: true }));
    const view: DispatchEvent = { key: "page_view", name: "page_view", triggerType: "page_view", params: {} };
    assert.deepEqual(adapter.page!(view, context()), { skipped: "already counted by the tracker" });
    host.location.pathname = "/about";
    adapter.page!(view, context());
    adapter.page!(view, context());
    assert.deepEqual(host.window._hsq, [["setPath", "/about"], ["trackPageView"]]);
  });

  it("sends a mapped event as a custom behavioural event, or skips it when forwarding is off", () => {
    const host = fakeHost();
    const adapter = hubspotAdapter({ host });
    adapter.initialize(settings(), context({ permitted: true }));
    adapter.track({ ...leadEvent, name: "contact_form_submission" }, context());
    assert.deepEqual(host.window._hsq, [["trackCustomBehavioralEvent", { name: "contact_form_submission", properties: { form_location: "footer" } }]]);
    const quiet = hubspotAdapter({ host: fakeHost() });
    quiet.initialize(settings({ eventForwarding: false }), context({ permitted: true }));
    assert.deepEqual(quiet.track(leadEvent, context()), { skipped: "event forwarding is off" });
  });

  it("does not load when disabled, and a failed script load leaves the others sending", () => {
    const host = fakeHost();
    const gtm = gtmAdapter({ host });
    const hubspot = hubspotAdapter({ host });
    const runtime = createAnalyticsRuntime({
      config: config({
        providers: { gtm: gtmSettings(), hubspot: settings() },
        events: [event({ mappings: [
          { provider: "hubspot", enabled: true, eventName: "contact_form_submission", aliases: [], conditions: [] },
          { provider: "gtm", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] },
        ] })],
      }),
      providers: [gtm, hubspot],
      consent: GRANTED,
    });
    runtime.start();
    host.scripts.find((s) => s.id === HUBSPOT_SCRIPT_ID)!.fail();
    const report = runtime.track("contact_form_submit", { form_location: "footer" })!;
    assert.deepEqual(report.providers.map((p) => [p.provider, p.status, p.reason]), [
      ["hubspot", "skipped", "provider unavailable"],
      ["gtm", "sent", undefined],
    ]);
    assert.deepEqual((host.window.dataLayer as unknown[]).at(-1), { event: "generate_lead", form_location: "footer" });

    const off = fakeHost();
    createAnalyticsRuntime({ config: config({ providers: {} }), providers: [hubspotAdapter({ host: off })], consent: GRANTED }).start();
    assert.equal(off.scripts.length, 0);
  });

  it("refuses a portal ID that is not numeric", () => {
    assert.deepEqual(hubspotProvider.project({ portalId: "abc" }, "production"), { off: "no valid portal ID" });
  });

  it("loads the tracker for the portal it is given, and injects nothing without a usable one", () => {
    const host = fakeHost();
    const adapter = hubspotAdapter({ host });
    adapter.initialize(settings({ portalId: "789" }), context({ permitted: true }));
    assert.equal(host.scripts[0]!.src, "https://js.hs-scripts.com/789.js");

    for (const portalId of ["", "abc"]) {
      const empty = fakeHost();
      const quiet = hubspotAdapter({ host: empty });
      quiet.initialize(settings({ portalId }), context({ permitted: true }));
      quiet.updateConsent!(context({ permitted: true }));
      assert.equal(empty.scripts.length, 0, portalId);
      assert.equal(quiet.isAvailable(), false, portalId);
    }
  });
});
