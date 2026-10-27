import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAnalyticsRuntime } from "../client/runtime.js";
import { createLogger } from "../core/logger.js";
import { config, DENIED, event, parameter, provider, recorder, memorySink } from "./support.js";

/* A trace of each event's route, only when asked for, never with personal values. */

const text = (lines: unknown[][]) => JSON.stringify(lines);

function runtimeWith(debug: boolean, overrides: Parameters<typeof config>[0] = {}) {
  const { sink, lines } = memorySink();
  const alpha = recorder("alpha");
  const runtime = createAnalyticsRuntime({
    config: config({ debug, providers: { alpha: provider(), beta: provider({ consent: "analytics" }) }, ...overrides }),
    providers: [alpha.adapter, recorder("beta").adapter],
    consent: DENIED,
    sink,
  });
  return { runtime, lines };
}

describe("debug mode", () => {
  it("logs the event, registry match, consent, and each provider's result and skip reason", () => {
    const { runtime, lines } = runtimeWith(true, {
      events: [
        event({
          mappings: [
            { provider: "alpha", enabled: true, eventName: "generate_lead", aliases: [], conditions: [] },
            { provider: "beta", enabled: true, eventName: "lead", aliases: [], conditions: [] },
          ],
        }),
      ],
    });
    runtime.track("contact_form_submit", { form_location: "footer" });
    const out = text(lines);
    assert.match(out, /contact_form_submit: alpha → generate_lead/);
    assert.match(out, /"Registry","matched"/);
    assert.match(out, /"Consent"/);
    assert.match(out, /alpha: generate_lead → sent/);
    assert.match(out, /beta: lead → skipped \(analytics consent not given\)/);
  });

  it("logs nothing when debug is off", () => {
    const { runtime, lines } = runtimeWith(false);
    runtime.track("contact_form_submit", {});
    runtime.track("unknown_event", {});
    assert.deepEqual(lines, []);
  });

  it("reports a validation failure and the disabled or unknown event", () => {
    const { runtime, lines } = runtimeWith(true, { events: [event({ parameters: [parameter("form_location", { required: true })] })] });
    runtime.track("contact_form_submit", {});
    runtime.track("disabled_event", {});
    const out = text(lines);
    assert.match(out, /validation failed: missing required form_location/);
    assert.match(out, /disabled_event: ignored \(not in the registry, disabled, or not for this environment\)/);
  });

  it("reports a provider failure", () => {
    const { sink, lines } = memorySink();
    const runtime = createAnalyticsRuntime({
      config: config({ debug: true }),
      providers: [recorder("alpha", { track: () => { throw new Error("script blocked"); } }).adapter],
      sink,
    });
    runtime.track("contact_form_submit", {});
    assert.match(text(lines), /alpha: generate_lead → failed \(script blocked\)/);
  });

  it("prints a received value only once validation accepted it", () => {
    const { sink, lines } = memorySink();
    createLogger(true, sink).event({
      event: "x",
      received: { email: "me@example.com", password: "hunter2", notes: "please call me on Friday", service: "web" },
      registry: "matched",
      validation: { ok: true, params: { service: "web", password: "hunter2" }, dropped: [{ name: "notes", reason: "not a parameter of x" }] },
      providers: [],
    });
    const out = text(lines);
    for (const secret of ["me@example.com", "hunter2", "Friday"]) assert.ok(!out.includes(secret), secret);
    assert.match(out, /"service":"web"/);
    assert.match(out, /"notes":"\[withheld\]"/);
  });

  it("names but withholds every value of an event it could not match", () => {
    const { sink, lines } = memorySink();
    createLogger(true, sink).event({ event: "x", received: { label: "free text" }, registry: "unknown", providers: [], ignored: "unknown" });
    const out = text(lines);
    assert.ok(!out.includes("free text"));
    assert.match(out, /"label":"\[withheld\]"/);
  });

  it("never lets a throwing console reach the page", () => {
    const broken = { groupCollapsed: () => { throw new Error("no console"); }, groupEnd() {}, log() {}, warn() {} };
    assert.doesNotThrow(() => createLogger(true, broken).event({ event: "x", received: {}, registry: "matched", providers: [] }));
  });
});
