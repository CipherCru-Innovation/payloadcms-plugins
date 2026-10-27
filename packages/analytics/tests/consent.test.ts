import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAnalyticsRuntime } from "../client/runtime.js";
import { isPermitted } from "../core/consent.js";
import { config, DENIED, event, GRANTED, provider, recorder, UNDECIDED } from "./support.js";

/* One gate between validation and dispatch; adapters are told, never decide. */

const policy = { required: true, whenUndecided: "denied" } as const;

describe("the consent gate", () => {
  it("analytics accepted and denied", () => {
    assert.ok(isPermitted("analytics", { ...DENIED, analytics: true }, policy));
    assert.ok(!isPermitted("analytics", DENIED, policy));
  });

  it("marketing accepted and denied", () => {
    assert.ok(isPermitted("marketing", { ...DENIED, marketing: true }, policy));
    assert.ok(!isPermitted("marketing", { ...DENIED, analytics: true }, policy));
  });

  it("treats an undecided visitor as configured, and 'none' as always permitted", () => {
    assert.ok(!isPermitted("analytics", UNDECIDED, policy));
    assert.ok(isPermitted("analytics", UNDECIDED, { required: true, whenUndecided: "granted" }));
    assert.ok(isPermitted("none", DENIED, policy));
    assert.ok(isPermitted("marketing", DENIED, { required: false, whenUndecided: "denied" }));
  });

  function mixed() {
    const open = recorder("open");
    const gated = recorder("gated");
    const runtime = createAnalyticsRuntime({
      config: config({
        providers: { open: provider({ consent: "none" }), gated: provider({ consent: "analytics" }) },
        events: [
          event({
            mappings: [
              { provider: "open", enabled: true, eventName: "e", aliases: [], conditions: [] },
              { provider: "gated", enabled: true, eventName: "e", aliases: [], conditions: [] },
              { provider: "open", enabled: true, eventName: "ads", aliases: [], conditions: [], consent: "marketing" },
            ],
          }),
        ],
      }),
      providers: [open.adapter, gated.adapter],
      consent: DENIED,
    });
    return { runtime, open, gated };
  }

  it("skips prohibited destinations and lets permitted ones continue", () => {
    const { runtime, open, gated } = mixed();
    const report = runtime.track("contact_form_submit", {})!;
    assert.equal(open.received.length, 1);
    assert.equal(gated.received.length, 0);
    assert.deepEqual(
      report.providers.map((p) => p.reason ?? p.status),
      ["sent", "analytics consent not given", "marketing consent not given"],
    );
  });

  it("applies a consent change to the next event and tells each adapter once", () => {
    const { runtime, open, gated } = mixed();
    runtime.start();
    runtime.setConsent(GRANTED);
    runtime.setConsent(GRANTED);
    runtime.track("contact_form_submit", {});
    assert.equal(open.received.length, 2);
    assert.equal(gated.received.length, 1);
    assert.equal(gated.consentUpdates.length, 1);
    assert.equal(gated.consentUpdates[0]!.permitted, true);
  });
});
