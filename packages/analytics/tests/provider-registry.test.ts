import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProviderRegistry, DuplicateProviderError } from "../providers/registry.js";
import { createAnalyticsRuntime } from "../client/runtime.js";
import { config, recorder } from "./support.js";

/* Providers register by name and the runtime resolves them without knowing any. */

describe("the provider registry", () => {
  it("registers and resolves a provider by name", () => {
    const { adapter } = recorder("mock");
    const registry = createProviderRegistry([adapter]);
    assert.equal(registry.resolve("mock"), adapter);
    assert.deepEqual(registry.names(), ["mock"]);
  });

  it("answers undefined for a provider nobody registered", () => {
    assert.equal(createProviderRegistry().resolve("missing"), undefined);
  });

  it("refuses a second provider under the same name", () => {
    const registry = createProviderRegistry([recorder("mock").adapter]);
    assert.throws(() => registry.register(recorder("mock").adapter), DuplicateProviderError);
  });

  it("refuses a name that is not lowercase letters and digits", () => {
    assert.throws(() => createProviderRegistry([recorder("Bad-Name").adapter]), /not a valid provider name/);
  });

  it("skips a mapped provider with no adapter, and one the configuration disabled", () => {
    const beta = recorder("beta");
    const runtime = createAnalyticsRuntime({
      config: config({
        providers: { beta: config().providers.beta! },
        events: [
          {
            ...config().events[0]!,
            mappings: [
              { provider: "alpha", enabled: true, eventName: "a", aliases: [], conditions: [] },
              { provider: "beta", enabled: true, eventName: "b", aliases: [], conditions: [] },
              { provider: "gamma", enabled: true, eventName: "c", aliases: [], conditions: [] },
            ],
          },
        ],
      }),
      providers: [recorder("alpha").adapter, beta.adapter],
    });
    const report = runtime.track("contact_form_submit", {})!;
    assert.deepEqual(
      report.providers.map((p) => [p.provider, p.status, p.reason]),
      [
        ["alpha", "skipped", "provider disabled"],
        ["beta", "sent", undefined],
        ["gamma", "skipped", "provider disabled"],
      ],
    );
    assert.equal(beta.received.length, 1);
  });

  it("leaves out a duplicate adapter rather than failing the runtime", () => {
    const first = recorder("alpha");
    const runtime = createAnalyticsRuntime({ config: config(), providers: [first.adapter, recorder("alpha").adapter] });
    runtime.track("contact_form_submit", {});
    assert.equal(first.received.length, 1);
  });
});
