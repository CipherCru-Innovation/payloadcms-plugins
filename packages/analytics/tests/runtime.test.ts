import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createAnalyticsRuntime, installAnalytics, uninstallAnalytics } from "../client/runtime.js";
import { analytics, track } from "../client/track.js";
import { forgetLastPageView, pageView } from "../client/pageView.js";
import { config, event, parameter, provider, recorder } from "./support.js";

/* One provider-independent API, and per-destination names and parameters. */

const threeWay = () =>
  event({
    parameters: [parameter("formLocation"), parameter("service")],
    mappings: [
      { provider: "ga", enabled: true, eventName: "generate_lead", aliases: [{ parameter: "formLocation", alias: "form_location" }], conditions: [] },
      { provider: "tm", enabled: true, eventName: "contact_form_submit", aliases: [], conditions: [] },
      { provider: "crm", enabled: true, eventName: "contact_form_submission", aliases: [{ parameter: "service", alias: "service_interest" }], conditions: [] },
    ],
  });

function setup(overrides: Parameters<typeof config>[0] = {}) {
  const ga = recorder("ga");
  const tm = recorder("tm");
  const crm = recorder("crm");
  const runtime = createAnalyticsRuntime({
    config: config({ providers: { ga: provider(), tm: provider(), crm: provider() }, events: [threeWay()], ...overrides }),
    providers: [ga.adapter, tm.adapter, crm.adapter],
  });
  return { runtime, ga, tm, crm };
}

describe("the analytics runtime", () => {
  it("dispatches a valid event to every configured provider", () => {
    const { runtime, ga, tm, crm } = setup();
    const report = runtime.track("contact_form_submit", { formLocation: "footer", service: "web" })!;
    assert.deepEqual(report.providers.map((p) => p.status), ["sent", "sent", "sent"]);
    assert.equal(ga.received.length + tm.received.length + crm.received.length, 3);
  });

  it("ignores an unknown event without throwing", () => {
    const { runtime, ga } = setup();
    const report = runtime.track("no_such_event", { a: 1 })!;
    assert.equal(report.registry, "unknown");
    assert.equal(ga.received.length, 0);
  });

  it("sends nothing for a disabled event, which the projection has already left out", () => {
    const { runtime, tm } = setup({ events: [] });
    assert.equal(runtime.track("contact_form_submit", {})!.registry, "unknown");
    assert.equal(tm.received.length, 0);
  });

  it("accepts an empty payload", () => {
    const { runtime, tm } = setup();
    runtime.track("contact_form_submit");
    assert.deepEqual(tm.received[0]!.event.params, {});
  });

  it("isolates a provider that throws or rejects: the others still receive the event", () => {
    const ga = recorder("ga", { track: () => { throw new Error("boom"); } });
    const tm = recorder("tm", { track: () => Promise.reject(new Error("later")) });
    const crm = recorder("crm");
    const runtime = createAnalyticsRuntime({
      config: config({ providers: { ga: provider(), tm: provider(), crm: provider() }, events: [threeWay()] }),
      providers: [ga.adapter, tm.adapter, crm.adapter],
    });
    const report = runtime.track("contact_form_submit", {})!;
    assert.deepEqual(report.providers.map((p) => p.status), ["failed", "sent", "sent"]);
    assert.equal(crm.received.length, 1);
  });

  it("dispatches synchronously, so events keep the order they were tracked in", () => {
    const { runtime, tm } = setup({
      events: [threeWay(), event({ key: "page_view", triggerType: "page_view", parameters: [], mappings: [{ provider: "tm", enabled: true, eventName: "page_view", aliases: [], conditions: [] }] })],
    });
    runtime.page({});
    runtime.track("contact_form_submit", {});
    assert.deepEqual(tm.received.map((r) => [r.method, r.event.name]), [["page", "page_view"], ["track", "contact_form_submit"]]);
  });

  it("sends nothing when analytics is off, or on a route the host does not measure", () => {
    const off = setup({ enabled: false });
    assert.equal(off.runtime.track("contact_form_submit", {})!.ignored, "analytics is off");
    const tm = recorder("tm");
    const unmeasured = createAnalyticsRuntime({
      config: config({ providers: { tm: provider() }, events: [threeWay()] }),
      providers: [tm.adapter],
      isMeasured: () => false,
    });
    assert.equal(unmeasured.track("contact_form_submit", {}), undefined);
    assert.equal(tm.received.length, 0);
  });
});

describe("provider mappings", () => {
  it("sends one internal event under a different name to each provider", () => {
    const { runtime, ga, tm, crm } = setup();
    runtime.track("contact_form_submit", { formLocation: "footer", service: "web" });
    assert.equal(ga.received[0]!.event.name, "generate_lead");
    assert.equal(tm.received[0]!.event.name, "contact_form_submit");
    assert.equal(crm.received[0]!.event.name, "contact_form_submission");
    assert.equal(ga.received[0]!.event.key, "contact_form_submit");
  });

  it("renames parameters per provider only", () => {
    const { runtime, ga, tm, crm } = setup();
    runtime.track("contact_form_submit", { formLocation: "footer", service: "web" });
    assert.deepEqual(ga.received[0]!.event.params, { form_location: "footer", service: "web" });
    assert.deepEqual(tm.received[0]!.event.params, { formLocation: "footer", service: "web" });
    assert.deepEqual(crm.received[0]!.event.params, { formLocation: "footer", service_interest: "web" });
  });

  it("disabling one provider leaves the others sending", () => {
    const { runtime, ga, tm, crm } = setup({ providers: { ga: provider(), crm: provider() } });
    runtime.track("contact_form_submit", {});
    assert.equal(tm.received.length, 0);
    assert.equal(ga.received.length, 1);
    assert.equal(crm.received.length, 1);
  });

  it("an event with no mapping for a provider never reaches it", () => {
    const { runtime, crm } = setup({ events: [event({ key: "contact_form_submit", mappings: [{ provider: "ga", enabled: true, eventName: "x", aliases: [], conditions: [] }] })] });
    const report = runtime.track("contact_form_submit", {})!;
    assert.deepEqual(report.providers.map((p) => p.provider), ["ga"]);
    assert.equal(crm.received.length, 0);
  });

  it("routes by condition, without affecting other destinations", () => {
    const { runtime, ga, tm } = setup({
      events: [
        event({
          parameters: [parameter("formLocation")],
          mappings: [
            { provider: "ga", enabled: true, eventName: "footer_lead", aliases: [], conditions: [{ field: "formLocation", operator: "equals", value: "footer" }] },
            { provider: "tm", enabled: true, eventName: "lead", aliases: [], conditions: [] },
          ],
        }),
      ],
    });
    runtime.track("contact_form_submit", { formLocation: "hero" });
    runtime.track("contact_form_submit", { formLocation: "footer" });
    assert.equal(ga.received.length, 1);
    assert.equal(tm.received.length, 2);
  });
});

describe("the installed runtime", () => {
  afterEach(() => {
    uninstallAnalytics();
    delete (globalThis as { window?: unknown }).window;
  });

  it("is a no-op before installation and on the server", () => {
    assert.equal(track("contact_form_submit", {}), undefined);
    assert.equal(installAnalytics({ config: config(), providers: [] }), undefined);
  });

  it("routes the facade's calls through the one installed instance", () => {
    (globalThis as { window?: unknown }).window = { location: { pathname: "/", href: "https://example.test/" } };
    const tm = recorder("tm");
    const first = installAnalytics({ config: config({ providers: { tm: provider() }, events: [threeWay()] }), providers: [tm.adapter] });
    const second = installAnalytics({ config: config(), providers: [] });
    assert.equal(first, second);
    analytics.track("contact_form_submit", { service: "web" });
    assert.equal(tm.received.length, 1);
  });

  it("counts one page view per navigation, however often the effect runs", () => {
    const location = { pathname: "/", href: "https://example.test/" };
    (globalThis as { window?: unknown }).window = { location };
    const tm = recorder("tm");
    const pageEvent = event({ key: "page_view", triggerType: "page_view", parameters: [parameter("page_title")], mappings: [{ provider: "tm", enabled: true, eventName: "page_view", aliases: [], conditions: [] }] });
    installAnalytics({ config: config({ providers: { tm: provider() }, events: [pageEvent] }), providers: [tm.adapter] })!.start();
    forgetLastPageView();
    pageView({ page_title: "Home" });
    pageView({ page_title: "Home" });
    Object.assign(location, { pathname: "/about", href: "https://example.test/about" });
    pageView({ page_title: "About" });
    Object.assign(location, { pathname: "/", href: "https://example.test/" });
    pageView({ page_title: "Home" });
    Object.assign(location, { href: "https://example.test/?page=2" });
    pageView({ page_title: "Home" });
    assert.deepEqual(tm.received.map((r) => [r.method, r.event.params.page_title]), [
      ["page", "Home"],
      ["page", "About"],
      ["page", "Home"],
      ["page", "Home"],
    ]);
    forgetLastPageView();
    pageView({ page_title: "Home" });
    assert.equal(tm.received.length, 5, "forgetting re-sends the current page on purpose");
  });
});
