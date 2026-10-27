import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createConfigLoader, projectConfig, serializeConfig } from "../server/config.js";
import { builtInProviders, hubspotPortal, hubspotPortalText } from "../providers/definitions.js";
import { hostValueProvider } from "./support.js";

/* What the CMS stores becomes what the browser may know, cached, and never a secret. */

const BUILT_IN_PROVIDERS = builtInProviders();

const settings = {
  enabled: true,
  environments: ["production", "staging"],
  debug: true,
  consentRequired: true,
  whenUndecided: "denied",
  unknownParameters: "drop",
  gtm: {
    enabled: true,
    consent: "none",
    containerId: "GTM-ABC1234",
    auth: "env-auth",
    preview: "env-3",
    requireEnvironmentOutsideProduction: true,
    dataLayerName: "dataLayer",
    adsDataRedaction: true,
    /* A field nothing projects: it must never reach the browser. */
    serverToken: "do-not-publish",
  },
  ga4: { enabled: true, consent: "none", deliveryMode: "via_gtm", measurementId: "G-ABC123" },
  hubspot: { enabled: false, consent: "analytics", portalId: "123" },
};

const storedEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "1",
  displayName: "Contact form submitted",
  eventKey: "contact_form_submit",
  triggerType: "form_submit",
  enabled: true,
  environments: [],
  consent: "none",
  parameters: [{ name: "form_location", type: "string", format: "text", required: true }],
  mappings: [
    { provider: "gtm", enabled: true, eventName: "generate_lead", consent: "inherit", aliases: [], conditions: [] },
    { provider: "hubspot", enabled: true, eventName: "contact_form_submission", consent: "inherit", aliases: [], conditions: [] },
  ],
  debugNotes: "internal",
  ...overrides,
});

const project = (
  environment: "production" | "staging" | "development",
  stored: Readonly<Record<string, unknown>> = settings,
  events = [storedEvent()],
) =>
  projectConfig({ settings: stored, events, providers: BUILT_IN_PROVIDERS, environment });

describe("the public projection", () => {
  it("publishes enabled providers and events, without secrets or unprojected fields", () => {
    const { config, skipped } = project("production");
    assert.deepEqual(Object.keys(config.providers), ["gtm", "ga4"]);
    assert.deepEqual(config.providers.gtm!.options, { containerId: "GTM-ABC1234", dataLayerName: "dataLayer", adsDataRedaction: true });
    assert.equal(skipped.hubspot, "disabled");
    const text = JSON.stringify(config);
    for (const secret of ["do-not-publish", "env-auth", "debugNotes", "displayName"]) assert.ok(!text.includes(secret), secret);
  });

  it("drops mappings to providers that are off, and the 'inherit' consent", () => {
    const event = project("production").config.events[0]!;
    assert.deepEqual(event.mappings.map((m) => m.provider), ["gtm"]);
    assert.equal("consent" in event.mappings[0]!, false);
  });

  it("drops a destination disabled for one event, while the provider serves the others", () => {
    const withHubspot = { ...settings, hubspot: { ...settings.hubspot, enabled: true } };
    const events = [
      storedEvent({ mappings: [
        { provider: "gtm", enabled: false, eventName: "generate_lead" },
        { provider: "hubspot", enabled: true, eventName: "contact_form_submission" },
      ] }),
      storedEvent({ eventKey: "cta_click", triggerType: "click", mappings: [{ provider: "gtm", enabled: true, eventName: "cta_click" }] }),
    ];
    const { config } = project("production", withHubspot, events);
    assert.deepEqual(config.events.map((e) => [e.key, e.mappings.map((m) => m.provider)]), [
      ["contact_form_submit", ["hubspot"]],
      ["cta_click", ["gtm"]],
    ]);
  });

  it("withholds an event whose stored condition it cannot read, rather than widen its audience", () => {
    const events = [
      storedEvent({ mappings: [{ provider: "gtm", enabled: true, eventName: "generate_lead", conditions: [{ field: "pagePath", operator: "matches", value: ".*" }] }] }),
      storedEvent({ eventKey: "cta_click", triggerType: "click" }),
    ];
    assert.deepEqual(project("production", settings, events).config.events.map((e) => e.key), ["cta_click"]);
  });

  it("excludes disabled events and events for other environments", () => {
    const events = [storedEvent({ eventKey: "off", enabled: false }), storedEvent({ eventKey: "staging_only", environments: ["staging"] }), storedEvent()];
    assert.deepEqual(project("production", settings, events).config.events.map((e) => e.key), ["contact_form_submit"]);
    assert.deepEqual(project("staging", settings, events).config.events.map((e) => e.key), ["staging_only", "contact_form_submit"]);
  });

  it("switches everything off in an environment analytics does not run in", () => {
    const { config } = project("development");
    assert.equal(config.enabled, false);
    assert.deepEqual(config.providers, {});
    assert.deepEqual(config.events, []);
  });

  it("never enables debug in production, and never sends a GTM environment there", () => {
    assert.equal(project("production").config.debug, false);
    assert.equal(project("staging").config.debug, true);
    assert.equal(project("staging").config.providers.gtm!.options.auth, "env-auth");
    assert.equal(project("production").config.providers.gtm!.options.auth, undefined);
  });

  it("serialises safely for a script element", () => {
    const text = serializeConfig({ ...project("production").config, events: [{ ...project("production").config.events[0]!, key: "</script>" }] });
    assert.ok(!text.includes("</script>"));
    assert.equal(JSON.parse(text).events[0].key, "</script>");
  });
});

describe("the configuration loader", () => {
  function counting() {
    const reads = { settings: 0, events: 0 };
    let current = settings;
    return {
      reads,
      set: (next: typeof settings) => {
        current = next;
      },
      source: {
        readSettings: async () => (reads.settings++, current),
        readEvents: async () => (reads.events++, [storedEvent()]),
      },
    };
  }

  it("fetches once, then serves the cached copy", async () => {
    const { reads, source } = counting();
    let clock = 0;
    const loader = createConfigLoader({ source, providers: BUILT_IN_PROVIDERS, environment: "production", ttlMs: 1000, now: () => clock });
    await loader.load();
    await Promise.all([loader.load(), loader.load()]);
    clock = 999;
    await loader.load();
    assert.deepEqual(reads, { settings: 1, events: 1 });
    clock = 1000;
    await loader.load();
    assert.deepEqual(reads, { settings: 2, events: 2 });
  });

  it("reads again after invalidation, so a CMS change is visible", async () => {
    const { reads, source, set } = counting();
    const loader = createConfigLoader({ source, providers: BUILT_IN_PROVIDERS, environment: "production" });
    assert.equal((await loader.load()).config.enabled, true);
    set({ ...settings, enabled: false });
    assert.equal((await loader.load()).config.enabled, true);
    loader.invalidate();
    assert.equal((await loader.load()).config.enabled, false);
    assert.equal(reads.settings, 2);
  });

  it("does not cache a failed read", async () => {
    let fail = true;
    const loader = createConfigLoader({
      source: {
        readSettings: async () => {
          if (fail) throw new Error("unreachable");
          return settings;
        },
        readEvents: async () => [],
      },
      providers: BUILT_IN_PROVIDERS,
      environment: "production",
    });
    await assert.rejects(loader.load());
    fail = false;
    assert.equal((await loader.load()).config.enabled, true);
  });
});

/* The portal is the plugin's own, on the HubSpot tab, and the host reads it from there. */
describe("HubSpot's portal, stored on its tab", () => {
  const withPortal = (portalId: unknown) => ({ ...settings, hubspot: { enabled: true, consent: "analytics", portalId } });

  it("publishes the stored portal, trimmed", () => {
    const { config, skipped } = project("production", withPortal(" 456 "));
    assert.deepEqual(config.providers.hubspot!.options, { portalId: "456", eventForwarding: false, disableCookieBanner: true });
    assert.deepEqual(skipped, {});
  });

  it("leaves HubSpot off, and the others on, without a portal", () => {
    for (const portalId of [undefined, null, "", "   "]) {
      const { config, skipped } = project("production", withPortal(portalId));
      assert.deepEqual(Object.keys(config.providers), ["gtm", "ga4"], String(portalId));
      assert.equal(skipped.hubspot, "no portal ID");
      assert.deepEqual(config.events[0]!.mappings.map((m) => m.provider), ["gtm"]);
    }
  });

  it("leaves HubSpot off when the portal is not digits", () => {
    const { config, skipped } = project("production", withPortal("12-34"));
    assert.equal(config.providers.hubspot, undefined);
    assert.equal(skipped.hubspot, "no valid portal ID");
  });

  it("gives the host the same portal through hubspotPortal(), whether or not HubSpot is on", () => {
    assert.equal(hubspotPortal(withPortal(" 456 ")), "456");
    assert.equal(hubspotPortal({ hubspot: { enabled: false, portalId: "789" } }), "789");
    for (const stored of [null, undefined, {}, { hubspot: {} }, withPortal(""), withPortal("12-34"), withPortal(123)]) {
      assert.equal(hubspotPortal(stored), null, JSON.stringify(stored));
    }
  });

  it("gives the host the portal as stored, trimmed, through hubspotPortalText()", () => {
    assert.deepEqual(
      [withPortal(" 456 "), withPortal("12-34"), withPortal("  "), withPortal(123), { hubspot: {} }, null].map(hubspotPortalText),
      ["456", "12-34", "", "", "", ""],
    );
  });
});

/* A provider may keep a value in the host and declare `supply()` for it; none of the built-ins does. */
describe("values a provider's host supplies", () => {
  const withHosted = { ...settings, hosted: { enabled: true, consent: "none" } };
  const hostedEvent = storedEvent({ mappings: [
    { provider: "gtm", enabled: true, eventName: "generate_lead" },
    { provider: "hosted", enabled: true, eventName: "lead" },
  ] });

  function loaderWith(read: () => Promise<string | null | undefined>) {
    const reads = { settings: 0, host: 0 };
    const loader = createConfigLoader({
      source: { readSettings: async () => (reads.settings++, withHosted), readEvents: async () => [hostedEvent] },
      providers: [...BUILT_IN_PROVIDERS, hostValueProvider(() => (reads.host++, read()))],
      environment: "production",
    });
    return { loader, reads };
  }

  it("publishes the host's value", async () => {
    const { config, skipped } = await loaderWith(async () => " k-1 ").loader.load();
    assert.deepEqual(config.providers.hosted!.options, { key: "k-1" });
    assert.equal(skipped.hosted, undefined);
  });

  it("leaves only that provider off when the host's read fails, and the page keeps the rest", async () => {
    const { config, skipped } = await loaderWith(async () => {
      throw new Error("unreachable");
    }).loader.load();
    assert.deepEqual(Object.keys(config.providers), ["gtm", "ga4"]);
    assert.equal(skipped.hosted, "the host's values for it could not be read");
    assert.deepEqual(config.events[0]!.mappings.map((m) => m.provider), ["gtm"]);
  });

  it("reads the host once per load, and again after invalidation, so a change there is seen", async () => {
    let value = "k-1";
    const { loader, reads } = loaderWith(async () => value);
    await Promise.all([loader.load(), loader.load()]);
    assert.deepEqual(reads, { settings: 1, host: 1 });
    value = "k-2";
    loader.invalidate();
    assert.equal((await loader.load()).config.providers.hosted!.options.key, "k-2");
    assert.deepEqual(reads, { settings: 2, host: 2 });
  });

  it("does not keep a load whose host read failed, so the next load reads again", async () => {
    let down = true;
    const { loader, reads } = loaderWith(async () => {
      if (down) throw new Error("unreachable");
      return "k-1";
    });
    assert.equal((await loader.load()).skipped.hosted, "the host's values for it could not be read");
    down = false;
    assert.equal((await loader.load()).config.providers.hosted?.options.key, "k-1");
    assert.deepEqual(reads, { settings: 2, host: 2 });
    await loader.load();
    assert.deepEqual(reads, { settings: 2, host: 2 });
  });

  it("projects as if the host had nothing when its values are not passed in", () => {
    const { config, skipped } = projectConfig({
      settings: withHosted,
      events: [],
      providers: [...BUILT_IN_PROVIDERS, hostValueProvider()],
      environment: "production",
    });
    assert.equal(config.providers.hosted, undefined);
    assert.equal(skipped.hosted, "no key from the host");
  });
});
