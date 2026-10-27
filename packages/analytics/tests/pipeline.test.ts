import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAnalyticsRuntime } from "../client/runtime.js";
import { metaProvider } from "../examples/meta/config.js";
import { metaAdapter } from "../examples/meta/adapter.js";
import { builtInProviders } from "../providers/definitions.js";
import { ga4Adapter } from "../providers/ga4/adapter.js";
import { gtmAdapter } from "../providers/gtm/adapter.js";
import { hubspotAdapter, HUBSPOT_SCRIPT_ID } from "../providers/hubspot/adapter.js";
import { projectConfig } from "../server/config.js";
import type { Environment } from "../core/types.js";
import { DENIED, fakeHost, GRANTED, UNDECIDED } from "./support.js";

/*
 * The whole route, from what the CMS stores to what each destination receives —
 * projection, registry, validation, conditions, consent, dispatch, adapter — with real
 * adapters against a stub browser. Nothing is sent anywhere.
 */

const settings = {
  enabled: true,
  environments: ["production", "staging"],
  consentRequired: true,
  whenUndecided: "denied",
  unknownParameters: "drop",
  gtm: { enabled: true, consent: "none", containerId: "GTM-ABC1234", auth: "a", preview: "env-2" },
  ga4: { enabled: true, consent: "none", deliveryMode: "via_gtm" },
  hubspot: { enabled: true, consent: "analytics", portalId: "123", eventForwarding: true },
  meta: { enabled: true, consent: "marketing", pixelId: "42" },
};

const stored = [
  {
    eventKey: "contact_form_submit",
    triggerType: "form_submit",
    enabled: true,
    consent: "none",
    parameters: [
      { name: "form_location", type: "string", format: "text", required: true },
      { name: "service", type: "string", format: "text" },
    ],
    mappings: [
      { provider: "gtm", enabled: true, eventName: "generate_lead", consent: "inherit", aliases: [{ parameter: "form_location", alias: "location" }] },
      { provider: "ga4", enabled: true, eventName: "generate_lead", consent: "inherit" },
      { provider: "hubspot", enabled: true, eventName: "contact_form_submission", consent: "inherit" },
      { provider: "meta", enabled: true, eventName: "Lead", consent: "inherit", conditions: [{ field: "form_location", operator: "equals", value: "footer" }] },
    ],
  },
  { eventKey: "switched_off", triggerType: "custom", enabled: false, consent: "none", mappings: [{ provider: "gtm", enabled: true, eventName: "x" }] },
  { eventKey: "staging_check", triggerType: "custom", enabled: true, environments: ["staging"], consent: "none", mappings: [{ provider: "gtm", enabled: true, eventName: "staging_check" }] },
  {
    eventKey: "page_view",
    triggerType: "page_view",
    enabled: true,
    consent: "none",
    parameters: [{ name: "page_location", type: "string", format: "url", required: true }],
    mappings: [
      { provider: "gtm", enabled: true, eventName: "page_view", conditions: [{ field: "pagePath", operator: "not_equals", value: "/private" }] },
      { provider: "hubspot", enabled: true, eventName: "page_view" },
    ],
  },
];

function site(environment: Environment, consent = GRANTED, pathname = "/contact") {
  const host = fakeHost(pathname);
  (globalThis as { window?: unknown }).window = host.window;
  const { config } = projectConfig({
    settings,
    events: stored,
    providers: [...builtInProviders(), metaProvider],
    environment,
  });
  const runtime = createAnalyticsRuntime({
    config,
    providers: [gtmAdapter({ host, now: () => 0 }), ga4Adapter({ host }), hubspotAdapter({ host }), metaAdapter({ host })],
    consent,
  });
  runtime.bootstrap();
  runtime.start();
  const layer = () => (host.window.dataLayer as unknown[]).filter((entry) => !Object.prototype.toString.call(entry).includes("Arguments"));
  return { host, runtime, layer };
}

const statuses = (report: ReturnType<ReturnType<typeof site>["runtime"]["track"]>) =>
  Object.fromEntries(report!.providers.map((p) => [p.provider, p.reason ?? p.status]));

describe("the analytics pipeline end to end", () => {
  it("routes a valid event to every destination under its own name and parameters", () => {
    const { runtime, layer, host } = site("production");
    const report = runtime.track("contact_form_submit", { form_location: "footer", service: "web" });
    assert.deepEqual(statuses(report), { gtm: "sent", ga4: "delivered by GTM", hubspot: "sent", meta: "sent" });
    assert.deepEqual(layer().at(-1), { event: "generate_lead", location: "footer", service: "web" });
    assert.deepEqual((host.window.fbq as { queue: unknown[][] }).queue.at(-1), ["trackCustom", "Lead", { form_location: "footer", service: "web" }]);
  });

  it("refuses an invalid event before any destination sees it", () => {
    const { runtime, layer } = site("production");
    const before = layer().length;
    const report = runtime.track("contact_form_submit", { service: "web" })!;
    assert.match(report.ignored ?? "", /missing required form_location/);
    assert.equal(layer().length, before);
  });

  it("never sends a disabled event, nor one meant for another environment", () => {
    const production = site("production");
    assert.equal(production.runtime.track("switched_off", {})!.registry, "unknown");
    assert.equal(production.runtime.track("staging_check", {})!.registry, "unknown");
    const staging = site("staging");
    assert.deepEqual(statuses(staging.runtime.track("staging_check", {})), { gtm: "sent" });
    assert.equal(site("development").runtime.track("contact_form_submit", { form_location: "x" })!.ignored, "analytics is off");
  });

  it("applies conditions per destination", () => {
    const { runtime } = site("production");
    assert.equal(statuses(runtime.track("contact_form_submit", { form_location: "hero" })).meta, "form_location equals \"footer\" did not hold");
    const page = site("production", GRANTED, "/private");
    assert.match(String(statuses(page.runtime.page({ page_location: "https://www.example.com/private" })).gtm), /pagePath not_equals/);
  });

  it("gates each destination on consent, and follows a change mid-session", () => {
    const { runtime, host } = site("production", UNDECIDED);
    assert.deepEqual(statuses(runtime.track("contact_form_submit", { form_location: "footer" })), {
      gtm: "sent",
      ga4: "delivered by GTM",
      hubspot: "analytics consent not given",
      meta: "marketing consent not given",
    });
    assert.equal(host.scripts.some((s) => s.id === HUBSPOT_SCRIPT_ID), false);

    runtime.setConsent({ ...DENIED, analytics: true });
    assert.equal(host.scripts.some((s) => s.id === HUBSPOT_SCRIPT_ID), true);
    const after = statuses(runtime.track("contact_form_submit", { form_location: "footer" }));
    assert.equal(after.hubspot, "sent");
    assert.equal(after.meta, "marketing consent not given");
  });

  it("keeps the others sending when one provider's script fails", () => {
    const { runtime, host, layer } = site("production");
    host.scripts.find((s) => s.id === HUBSPOT_SCRIPT_ID)!.fail();
    const report = runtime.track("contact_form_submit", { form_location: "footer" });
    assert.equal(statuses(report).hubspot, "provider unavailable");
    assert.equal(statuses(report).gtm, "sent");
    assert.equal((layer().at(-1) as { event: string }).event, "generate_lead");
  });

  it("sends a page view only where the registry maps one, the new provider included", () => {
    const { runtime, host, layer } = site("production", GRANTED, "/contact");
    host.location.pathname = "/about";
    const report = runtime.page({ page_location: "https://www.example.com/about" });
    assert.deepEqual(statuses(report), { gtm: "sent", hubspot: "sent" });
    assert.deepEqual(layer().at(-1), { event: "page_view", page_location: "https://www.example.com/about" });
    assert.deepEqual((host.window._hsq as unknown[]).slice(-2), [["setPath", "/about"], ["trackPageView"]]);
    assert.deepEqual((host.window.fbq as { queue: unknown[][] }).queue.map((call) => call[0]), ["init"]);
  });

  it("loads HubSpot's tracker for the stored portal, and nothing without one", () => {
    for (const [portalId, src] of [["789", "https://js.hs-scripts.com/789.js"], ["", undefined]] as const) {
      const providers = [...builtInProviders(), metaProvider];
      const withPortal = { ...settings, hubspot: { ...settings.hubspot, portalId } };
      const { config } = projectConfig({ settings: withPortal, events: stored, providers, environment: "production" });
      const host = fakeHost("/contact");
      (globalThis as { window?: unknown }).window = host.window;
      createAnalyticsRuntime({ config, providers: [gtmAdapter({ host, now: () => 0 }), hubspotAdapter({ host })], consent: GRANTED }).start();
      assert.equal(host.scripts.find((script) => script.id === HUBSPOT_SCRIPT_ID)?.src, src, portalId);
    }
  });
});
