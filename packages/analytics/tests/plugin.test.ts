import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ValidationError, type Config, type Field, type GlobalConfig } from "payload";

import { analyticsPlugin } from "../plugin.js";
import { builtInProviders } from "../providers/definitions.js";
import type { ProviderDefinition } from "../providers/types.js";
import { hostValueProvider } from "./support.js";

/* The plugin registers with Payload, and disabled it keeps the schema but adds no behaviour. */

const BUILT_IN_PROVIDERS = builtInProviders();

const base = { collections: [{ slug: "pages", fields: [] }], globals: [], endpoints: [] } as unknown as Config;

type NamedField = { name?: string; type: string; fields?: NamedField[]; admin?: { hidden?: boolean }; validate?: unknown };
const flatten = (fields: readonly NamedField[]): NamedField[] =>
  fields.flatMap((field) => [...(field.name ? [field] : []), ...flatten(field.fields ?? [])]);
const fieldNames = (fields: readonly NamedField[]): string[] =>
  flatten(fields).filter((field) => !field.admin?.hidden).map((field) => field.name!);

const apply = (enabled?: boolean) =>
  analyticsPlugin({ enabled, providers: BUILT_IN_PROVIDERS })(base) as Config;

const tabNames = (global: GlobalConfig) => {
  const tabs = global.fields.find((field: Field) => field.type === "tabs") as { tabs: { name?: string; label: string }[] };
  return tabs.tabs.map((tab) => tab.name ?? tab.label);
};

describe("the analytics plugin", () => {
  it("adds the settings global and the events collection, keeping what was there", () => {
    const config = apply();
    assert.deepEqual(config.collections?.map((c) => c.slug), ["pages", "analytics-events"]);
    assert.deepEqual(config.globals?.map((g) => g.slug), ["analytics-settings"]);
  });

  it("gives the settings a General tab and one tab per provider", () => {
    assert.deepEqual(tabNames(apply().globals![0]!), ["General", "gtm", "ga4", "hubspot"]);
  });

  it("adds the preview endpoint and change hooks only when enabled", () => {
    const on = apply(true);
    assert.ok(on.endpoints?.some((endpoint) => endpoint.path === "/analytics/preview"));
    assert.equal(on.collections![1]!.hooks?.afterChange?.length, 1);
    assert.equal(on.globals![0]!.hooks?.afterChange?.length, 1);
  });

  it("tells the host after every save and delete, and a failing host never fails the save", async () => {
    const calls: unknown[] = [];
    const errors: string[] = [];
    const config = analyticsPlugin({
      providers: BUILT_IN_PROVIDERS,
      onChange: ({ payload }) => {
        calls.push(payload);
        if (calls.length === 3) throw new Error("revalidation unavailable");
      },
    })(base) as Config;
    const payload = { logger: { error: (message: string) => errors.push(message) } };
    const req = { payload } as never;
    const doc = { id: "1" };
    const events = config.collections![1]!.hooks!;
    const settings = config.globals![0]!.hooks!;
    assert.equal(await (events.afterChange![0] as (args: unknown) => Promise<unknown>)({ doc, req }), doc);
    assert.equal(await (settings.afterChange![0] as (args: unknown) => Promise<unknown>)({ doc, req }), doc);
    assert.equal(await (events.afterDelete![0] as (args: unknown) => Promise<unknown>)({ doc, req }), doc);
    assert.deepEqual(calls, [payload, payload, payload]);
    assert.match(errors[0] ?? "", /not refreshed: revalidation unavailable/);
  });

  it("keeps the schema but adds no hooks or endpoints when disabled", () => {
    const off = apply(false);
    assert.deepEqual(off.collections?.map((c) => c.slug), ["pages", "analytics-events"]);
    assert.deepEqual(off.globals?.map((g) => g.slug), ["analytics-settings"]);
    assert.equal(off.endpoints?.length, 0);
    assert.equal(off.collections![1]!.hooks?.afterChange?.length, 0);
    assert.equal(off.globals![0]!.hooks?.afterChange?.length, 0);
  });

  it("adds the host's settings hooks after its own of each kind, enabled or not", () => {
    const beforeOperation = () => undefined;
    const beforeValidate = () => undefined;
    const afterChange = () => undefined;
    for (const enabled of [true, false]) {
      const config = analyticsPlugin({
        enabled,
        providers: BUILT_IN_PROVIDERS,
        hooks: { settings: { beforeOperation: [beforeOperation], beforeValidate: [beforeValidate], afterChange: [afterChange] } },
      })(base) as Config;
      const hooks = config.globals![0]!.hooks!;
      assert.deepEqual(hooks.beforeOperation, [beforeOperation]);
      assert.deepEqual([hooks.beforeValidate?.length, hooks.beforeValidate?.[1]], [2, beforeValidate]);
      assert.deepEqual([hooks.afterChange?.length, hooks.afterChange?.at(-1)], [enabled ? 2 : 1, afterChange]);
    }
    assert.deepEqual(Object.keys(apply().globals![0]!.hooks!), ["beforeValidate", "afterChange"]);
  });

  it("refuses a provider registered twice, and one whose id clashes with a settings field", () => {
    assert.throws(() => analyticsPlugin({ providers: [BUILT_IN_PROVIDERS[0]!, BUILT_IN_PROVIDERS[0]!] }), /registered twice/);
    const clash = { ...BUILT_IN_PROVIDERS[0]!, id: "debug" } as ProviderDefinition;
    assert.throws(() => analyticsPlugin({ providers: [clash] })(base), /clashes/);
  });

  it("honours the host's slugs, sidebar heading and access", () => {
    const read = () => false;
    const config = analyticsPlugin({
      providers: BUILT_IN_PROVIDERS,
      slugs: { settings: "tracking", events: "tracked-events" },
      adminGroup: "Configuration",
      access: { settings: { read } },
    })(base) as Config;
    const global = config.globals![0]!;
    assert.equal(global.slug, "tracking");
    assert.equal(global.admin?.group, "Configuration");
    assert.equal(global.access?.read, read);
    assert.equal(config.collections![1]!.slug, "tracked-events");
    assert.equal(config.collections![1]!.dbName, "tracked-events");
  });
});

/* The portal is the plugin's own field, the one copy the tracker and the host both read. */
describe("HubSpot's portal, on its own tab", () => {
  const hubspotTab = (global: GlobalConfig) => {
    const tabs = global.fields.find((field: Field) => field.type === "tabs") as {
      tabs: { name?: string; admin?: { description?: unknown }; fields: NamedField[] }[];
    };
    return tabs.tabs.find((tab) => tab.name === "hubspot")!;
  };
  const portalField = () =>
    flatten(hubspotTab(apply().globals![0]!).fields).find((field) => field.name === "portalId") as NamedField & {
      validate: (value: unknown, options: { siblingData?: Record<string, unknown> }) => true | string;
    };

  it("gives the HubSpot tab a portal field an editor sees", () => {
    const tab = hubspotTab(apply().globals![0]!);
    assert.deepEqual(fieldNames(tab.fields), ["enabled", "debug", "consent", "portalId", "eventForwarding", "disableCookieBanner"]);
    assert.equal(tab.admin?.description, undefined);
  });

  it("takes digits only, and refuses HubSpot switched on without one", () => {
    const { validate } = portalField();
    assert.equal(validate("12345678", { siblingData: { enabled: true } }), true);
    assert.equal(validate(" 12345678 ", { siblingData: { enabled: true } }), true);
    assert.equal(validate("", { siblingData: { enabled: false } }), true);
    assert.equal(validate(undefined, { siblingData: {} }), true);
    assert.match(String(validate("", { siblingData: { enabled: true } })), /cannot be switched on without its portal/);
    assert.match(String(validate(null, { siblingData: { enabled: true } })), /cannot be switched on without its portal/);
    assert.match(String(validate("12-34", { siblingData: { enabled: false } })), /digits only/);
  });

  it("previews HubSpot with the stored portal", async () => {
    const config = analyticsPlugin({ providers: BUILT_IN_PROVIDERS })(base) as Config;
    const preview = config.endpoints!.find((endpoint) => endpoint.path === "/analytics/preview")!;
    const payload = {
      findGlobal: async () => ({
        enabled: true,
        environments: ["production"],
        hubspot: { enabled: true, consent: "analytics", portalId: "456" },
      }),
      find: async () => ({ docs: [] }),
    };
    const response = await preview.handler({ payload, user: { id: 1 }, url: "http://localhost/api/analytics/preview" } as never);
    const body = (await response.json()) as { config: { providers: Record<string, { options: Record<string, unknown> }> } };
    assert.equal(body.config.providers.hubspot?.options.portalId, "456");
  });
});

/* A provider's `validateSettings` sees what its host supplies, and the host is asked only while it is on. */
describe("saving a provider whose host supplies a value", () => {
  function save(read: () => Promise<string | null>, hosted: Record<string, unknown>) {
    let reads = 0;
    const global = analyticsPlugin({
      providers: [...BUILT_IN_PROVIDERS, hostValueProvider(() => (reads++, read()))],
    })(base) as Config;
    const hook = global.globals![0]!.hooks!.beforeValidate![0] as (args: unknown) => Promise<unknown>;
    const data = { enabled: true, gtm: { enabled: false }, ga4: { enabled: false }, hubspot: { enabled: false }, hosted };
    return { result: hook({ data, req: { payload: {} } }), reads: () => reads };
  }
  const refusedWith = (pattern: RegExp) => (error: unknown) => {
    assert.ok(error instanceof ValidationError, String(error));
    const errors = (error.data as { errors: { path: string; message: string }[] }).errors;
    assert.deepEqual(errors.map((entry) => entry.path), ["hosted"]);
    assert.match(errors[0]!.message, pattern);
    return true;
  };

  it("refuses it switched on while the host has no value", async () => {
    for (const answer of [null, ""]) {
      await assert.rejects(save(async () => answer, { enabled: true }).result, refusedWith(/has no key/));
    }
  });

  it("refuses it when the host's value cannot be read", async () => {
    const failing = save(async () => {
      throw new Error("unreachable");
    }, { enabled: true });
    await assert.rejects(failing.result, refusedWith(/could not be read/));
  });

  it("accepts it with a value, and never asks the host while it is off", async () => {
    await save(async () => "k-1", { enabled: true }).result;
    const off = save(async () => null, { enabled: false });
    await off.result;
    assert.equal(off.reads(), 0);
  });
});
