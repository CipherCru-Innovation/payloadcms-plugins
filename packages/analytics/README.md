# @ciphercru/payload-analytics

[![npm](https://img.shields.io/npm/v/@ciphercru/payload-analytics)](https://www.npmjs.com/package/@ciphercru/payload-analytics)
[![license](https://img.shields.io/npm/l/@ciphercru/payload-analytics)](./LICENSE)

A Payload CMS plugin that governs analytics: which events a website may report, where each
one goes, under what name, with which parameters, on what consent, and in which environments.
The website reports **what happened** (`contact_form_submit`). The plugin decides the rest.

Destinations ship for **Google Tag Manager**, **Google Analytics 4** and **HubSpot**. Others
are added as a folder of their own, without touching the core or any code that tracks events.

```
Website interaction ─▶ analytics.track("contact_form_submit", { form_location: "footer" })
                                      │
          registry ─▶ validation ─▶ per destination: conditions ─▶ consent gate ─▶ aliases
                                      │
                ┌─────────────────────┼──────────────────────┐
                ▼                     ▼                      ▼
          GTM adapter            GA4 adapter           HubSpot adapter
       dataLayer.push        gtag / "via GTM"        _hsq / _hsp queues
```

Contents: [Installation](#installation) · [Configuration](#configuration) ·
[Architecture](#architecture) · [Creating events](#creating-events) ·
[Tracking events](#tracking-events) · [Provider architecture](#provider-architecture) ·
[GA4 setup](#ga4-setup) · [GTM setup](#gtm-setup) · [HubSpot setup](#hubspot-setup) ·
[Consent](#consent) · [Adding a provider](#adding-a-provider) ·
[Versioning](#versioning) · [Testing](#testing) · [Troubleshooting](#troubleshooting)

---

## Installation

```sh
npm install @ciphercru/payload-analytics
```

The package is compiled ES modules with type declarations. Its peers are Payload 3.89 or
later and, for the React binding only, React 19. It has no dependencies of its own.

It has six entry points, and each one keeps its side of the boundary. The package's `exports`
refuses any other path:

| Import                                            | Where it runs                           | Imports Payload |
| ------------------------------------------------- | --------------------------------------- | --------------- |
| `@ciphercru/payload-analytics`                    | Payload config only                     | yes             |
| `@ciphercru/payload-analytics/server`             | server code that renders public pages   | no (types only) |
| `@ciphercru/payload-analytics/client`             | the browser, including pre-hydration    | no              |
| `@ciphercru/payload-analytics/client/react`       | React client components (optional)      | no              |
| `@ciphercru/payload-analytics/providers/adapters` | the browser                             | no              |
| `@ciphercru/payload-analytics/csp`                | anything that builds a CSP (plain data) | no              |

Build the provider list once, where both the Payload config and your public pages can import
it. HubSpot's portal is a setting of this plugin; if your application also sends HubSpot
forms, read the portal from here with `hubspotPortal()` rather than keeping a second copy
(see [HubSpot setup](#hubspot-setup)):

```ts
// analytics-providers.ts — imported by the Payload config and by the page loader below
import { builtInProviders } from "@ciphercru/payload-analytics/server";

export const providers = builtInProviders();
```

Register the plugin:

```ts
// payload.config.ts
import { analyticsPlugin } from "@ciphercru/payload-analytics";
import { providers } from "./analytics-providers";

export default buildConfig({
  // ...
  plugins: [
    analyticsPlugin({
      providers,
      adminGroup: "Configuration",
      access: {
        settings: { read: isAdmin, update: isAdmin },
        events: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
      },
      onChange: async () => {
        /* Drop your cached copy of the configuration; see "Configuration loading". */
      },
    }),
  ],
});
```

Then run `payload generate:types`: the plugin adds the `analytics-settings` global and the
`analytics-events` collection.

## Configuration

`analyticsPlugin(options)`:

| Option       | Default                               | Meaning                                                                                                   |
| ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `providers`  | required                              | Provider definitions the CMS can configure, usually `builtInProviders()`. Their order is the settings tabs' order. |
| `enabled`    | `true`                                | `false` keeps the global and collection registered with their validation hooks and the host's `hooks` (schema, data and rules survive), but adds no `onChange` hooks and no preview endpoint. |
| `access`     | signed-in users                       | Payload `Access` functions for the settings (`read`, `update`) and the events (`read`, `create`, `update`, `delete`). |
| `adminGroup` | `"Analytics"`                         | Sidebar heading for both.                                                                                 |
| `slugs`      | `analytics-settings`, `analytics-events` | Rename them if they clash. The events collection's `dbName` is pinned to its slug.                     |
| `onChange`   | none                                  | Called after any save or delete. A failure is logged and never undoes the save.                           |
| `hooks`      | none                                  | `{ settings }`: the host's own Payload hooks on the settings global, each kind run after the plugin's, such as a rule guarding a value the host also reads (see [HubSpot setup](#hubspot-setup)). |

**Analytics Settings** (a global) holds what applies across events:

- **General**: the master switch; the environments that send events (production only by
  default, so test traffic never reaches production reports unless ticked); debug mode
  (ignored in production); whether consent is required and how an undecided visitor is
  treated; and whether an undeclared parameter is dropped or refuses the whole event.
- **One tab per provider**: enabled, debug, the consent that destination needs, and the
  provider's own fields. Every field that reaches the browser says so in its description. A
  provider whose value lives in the host says where at the top of its tab.

### Configuration loading

The browser never asks Payload for configuration. The server builds a **public projection**
once and renders it into the page:

```ts
import { createConfigLoader, serializeConfig } from "@ciphercru/payload-analytics/server";
import { providers } from "./analytics-providers";

const loader = createConfigLoader({
  source: {
    readSettings: async () => db.collection("globals").findOne({ globalType: "analytics-settings" }),
    readEvents: async () => db.collection("analytics-events").find({}).toArray(),
  },
  providers,
  environment: "production", // "development" | "staging" | "production"
  ttlMs: 60_000,
});

const { config } = await loader.load();
// <script id="analytics-config" type="application/json">{serializeConfig(config)}</script>
```

The projection copies named fields only. A settings field is public only if a provider's
`project()` publishes it, so a new field is private by default. Disabled events, events for
other environments, disabled providers, and mappings to them are left out. Debug is never
on in production. `loader.invalidate()` drops the cache; call it from `onChange`, and from
wherever a value a provider's `supply()` reads changes. Reads are shared, so a page render
never causes more than one read per `ttlMs`, and tracking an event never causes one.

A provider's host values (`supply()`, below) are read with the settings, once per load.
`projectConfig()` itself stays synchronous and pure: a caller that projects directly passes
them in as `supplied` (`await readSupplied(providers)`), and without them such a provider is off.
None of the built-ins needs any.

`GET /api/analytics/preview?environment=staging` returns the projection a page in that
environment would receive, plus the providers left off and why. It answers only to users
who may read the settings.

## Architecture

```
packages/analytics/
  index.ts  plugin.ts  plugin-options.ts   Payload side
  core/          types, rules, registry, validator, conditions, consent, logger, dispatcher
  providers/     types (the contract), registry, dom helpers, definitions, adapters
    gtm/ ga4/ hubspot/    config.ts (server half) · adapter.ts (browser half) · csp.ts · types.ts
  collections/AnalyticsEvents.ts    globals/AnalyticsSettings.ts
  server/        config.ts (projection + loader) · endpoints.ts (preview)
  client/        runtime.ts · track.ts · pageView.ts · config.ts
                 react.ts → AnalyticsProvider.tsx · AnalyticsContext.ts (optional React binding)
  examples/meta/ a worked example provider, exercised by the tests
  csp.ts         every built-in provider's CSP hosts
  tests/
```

There is no `admin/components/`: the admin needs no custom React. The events list shows each
event's key, trigger, status, consent, environments and a `destinations` summary
(`gtm: generate_lead · hubspot: …`) as plain columns, so nothing executable is configured
in the CMS.

Three rules hold the layers apart. Each one is enforced by `tests/boundary.test.ts`:

1. `core/` names no provider. It resolves adapters by name from a registry.
2. Nothing in `core/`, `client/`, `server/config.ts` or `providers/` imports Payload at runtime.
3. Nothing in the plugin imports the host application.

The pipeline for `track(key, payload)` is:

1. **Registry**: the published definition for `key`. Unknown, disabled or out-of-environment
   keys stop here.
2. **Validation**: only declared parameters of the declared type pass. Undeclared ones are
   dropped or refuse the event. Nested values never pass. A missing required value refuses
   the event. Every string goes through the privacy guard (below).
3. **Each destination** in the event's mappings:
   1. **Conditions**: declarative rules on parameters and on `pagePath` / `environment`.
   2. **Consent gate**: the mapping's (or event's) requirement **and** the provider's own.
   3. **Aliases**: parameter names are renamed for this destination only.
   4. **Adapter**: `page()` for `page_view` triggers when the adapter has one, otherwise `track()`.

Dispatch is synchronous. Two events tracked in one tick reach every destination in that
order. Nothing it does throws into the page: an adapter that throws, rejects, is missing or
is unavailable is reported and skipped, and the others still send.

**Privacy guard.** For `text` parameters, a value containing `@` or a run of seven or more
digits is refused, and so is one over its length limit (100 unless set, or truncated if
`truncate` is set). A `url` keeps its shape, loses its credentials, has email-like query
values replaced with `[redacted]`, and is cut to length. A `title` is truncated, never
refused. Parameter *names* that suggest secrets or personal data (`password`, `token`,
`email`, `phone`, `message`, and others) are refused by the CMS unless an administrator marks
the parameter as reviewed.

## Creating events

In the admin, open **Analytics Events → Create**:

| Field                | Rules                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Internal event key   | lowercase snake_case, unique, and no provider prefix (`ga4_…` is refused). Keep it stable once deployed. |
| Trigger type         | `page_view`, `click`, `form_submit`, `download`, `outbound_link`, `scroll` or `custom`. It describes the event; the application still decides when it fires. |
| Enabled              | off keeps the record but sends nothing.                                                                   |
| Allowed environments | blank means wherever the settings allow.                                                                  |
| Consent requirement  | `none`, `analytics` or `marketing`. A destination may override it.                                        |
| Parameters           | name, type (`string`, `number`, `boolean`), required, and for strings a format (`text`, `url`, `title`), a length and whether to truncate. |
| Destinations         | one row per provider: its event name, on/off, a consent override, parameter aliases and conditions.       |

The list view shows each event's key, trigger, status, consent, environments and a
destinations summary such as `gtm: generate_lead · hubspot: contact_form_submission (off)`.

Business events should describe outcomes, not attempts. Track `contact_form_submit` after
the server has accepted the submission, not when the button is pressed.

## Tracking events

Install the runtime once, before hydration, with the configuration the server rendered:

```ts
import { installAnalytics, readConfig } from "@ciphercru/payload-analytics/client";
import { ga4Adapter, gtmAdapter, hubspotAdapter } from "@ciphercru/payload-analytics/providers/adapters";

const config = readConfig(); // from <script id="analytics-config">
if (config) {
  installAnalytics({
    config,
    providers: [gtmAdapter(), ga4Adapter(), hubspotAdapter()],
    consent: { decided: false, analytics: false, marketing: false }, // from your banner
    globals: {}, // set on each provider's first hit, e.g. { traffic_type: "internal" }
    isMeasured: (pathname) => !pathname.startsWith("/admin"),
  })?.bootstrap();
}
```

After hydration, start the providers and keep consent current:

```ts
import { installedAnalytics } from "@ciphercru/payload-analytics/client";

installedAnalytics()?.start();              // loads provider scripts; idempotent
installedAnalytics()?.setConsent(newState); // after the banner changes
```

Then, anywhere in the application:

```ts
import { analytics } from "@ciphercru/payload-analytics/client";

analytics.track("contact_form_submit", { form_location: "footer", service: "web-development" });
analytics.page({ page_location: location.href, page_title: document.title });
```

For page views, `pageView(payload)` wraps `analytics.page()` and drops a repeat for the same
URL and payload, so a navigation effect that runs twice (React's development mode) counts
once. Call it when a navigation has settled, not on every render. `forgetLastPageView()`
clears that memory, for tests or to re-send the current page on purpose.

In a React tree, the optional binding does the `start()` and `setConsent()` calls for you:

```tsx
import { AnalyticsProvider, useAnalytics } from "@ciphercru/payload-analytics/client/react";

<AnalyticsProvider consent={consentState /* undefined until known */}>{children}</AnalyticsProvider>;

const analytics = useAnalytics(); // the same object as the `analytics` import
```

`track()` returns a report of what happened to the event: the registry match, the
validation outcome, and each destination's result or skip reason. It is a no-op before
installation and on the server.

Components never import an adapter. Routing is the runtime's job, not theirs.

## Provider architecture

A provider has two halves. Both are in `providers/types.ts`.

**`ProviderDefinition`** (server side):

```ts
interface ProviderDefinition {
  id: string;                          // lowercase letters and digits; the settings tab's name
  label: string;
  description?: string;                // a line at the top of its settings tab
  fields: Field[];                     // its settings fields (enabled, debug, consent are added)
  defaultConsent: ConsentRequirement;
  csp: CspSources;                     // hosts a Content Security Policy must allow
  supply?(): Promise<Record<string, unknown>>;                    // values the host keeps, read per load
  project(stored, environment, supplied): { options } | { off: reason };   // the only way a value goes public
  validateEventName?(name): true | string;
  validateSettings?(own, all, supplied): true | string;          // on save; `supplied` while enabled
}
```

**`AnalyticsProvider`** (the browser adapter):

```ts
interface AnalyticsProvider {
  name: string;
  bootstrap?(settings, context): void;       // synchronous, before hydration
  initialize(settings, context): void;       // after hydration: load scripts
  track(event, context): void | { skipped: string } | Promise<…>;
  page?(event, context): …;                  // for page_view triggers
  updateConsent?(context): void;             // context.permitted is already decided
  isAvailable(): boolean;
}
```

`supply()` is for a value the host already owns, so the settings never hold a second copy that
can drift from it. Its result reaches `project()` as `supplied`; a rejection switches that
provider off ("the host's values for it could not be read") and leaves the others on, and the
loader keeps no load with a failed read, so the next one tries again. On save, a provider being
saved enabled is supplied too, and `validateSettings` gets the values, or null if the read failed.

Adapters take their browser globals as a parameter (`{ host }`), so tests hand them a stub.
An adapter never reads a cookie or decides consent. It is told `context.permitted` and the
normalised `context.consent`.

## GA4 setup

1. In the **GA4** tab, enable the provider and choose a **delivery** mode:
   - **Through the GTM container** (default). The container runs the GA4 tags, and this
     adapter sends nothing and reports `delivered by GTM`. GTM must be enabled; the settings
     refuse otherwise. Build the GA4 tags in GTM (see below).
   - **Directly, with gtag.js**. Enter the **measurement ID** (`G-XXXXXXXXXX`). The adapter
     loads gtag.js once, sets Google Consent Mode's default, configures GA4 with
     `send_page_view: false`, and sends each mapped event as `gtag("event", name, params)`.
     The settings refuse this while GTM is enabled: the plugin cannot see whether the
     container also runs GA4 tags, and if it did every event would count twice.
2. Map events to GA4 names in each event's **Destinations**. GA4 limits names to 40
   characters and reserves `google_`, `ga_` and `firebase_`. The CMS enforces both.
3. With debug on outside production, direct delivery adds `debug_mode`, so events appear in
   GA4 **DebugView**.

## GTM setup

1. In the **Google Tag Manager** tab, enable it and enter the **container ID** (`GTM-XXXXXXX`).
2. Outside production the container loads only with a **GTM environment** (`gtm_auth` and
   `gtm_preview`, from the environment's snippet), unless you untick that rule. This keeps
   development traffic out of the live container. An environment is never sent on production.
3. Optionally rename the **dataLayer**. Tags must then read the same name.
4. Before `gtm.js` loads, the adapter pushes, in order: Consent Mode's default (ad storage
   denied; analytics storage from the visitor's choice; `wait_for_update: 500` while they
   have not answered), `ads_data_redaction`, any host globals, and `gtm.start`. Consent
   commands are pushed as `arguments` objects. GTM silently ignores them as arrays.
5. Each mapped event arrives as `{ event: <GTM event name>, ...parameters }`. In GTM, make
   a Custom Event trigger per name and a Data Layer Variable per parameter.
6. Check with **Preview** (Tag Assistant). The container should appear once, and each event
   with its parameters.

## HubSpot setup

1. **Set the portal (Hub ID)** on the HubSpot tab: digits only, and required while HubSpot is
   on. Without a valid one HubSpot stays off and loads no script; the preview endpoint says so.
   It is the one copy: anything else your application sends to HubSpot, such as form
   submissions, should read it with `hubspotPortal(settings)` from `./server`, which takes the
   stored settings and returns the portal or null; `hubspotPortalText(settings)` returns it as
   stored, trimmed, with `""` for blank. Then leads and browsing history land in one
   account, and changing it moves both. Clearing it would then stop those submissions too, and
   the plugin cannot see them, so the host refuses that itself with a `hooks.settings` rule:
   `beforeChange` for a save, and `beforeOperation` for a version restore, which Payload writes
   without the save hooks or field validation.
2. In the **HubSpot** tab, enable it and choose the **consent** it needs (analytics by
   default). The tracker script is loaded only once the gate permits it, with
   `setHubSpotConsent` already queued. A withdrawal queues `revokeCookieConsent`.
3. **Hide HubSpot's own cookie banner** (on by default) so your banner is the only one.
4. Page views: HubSpot counts the page its script loads on. Each later client-side
   navigation mapped as `page_view` is sent as `setPath` + `trackPageView`, once per path.
5. **Forward mapped events** sends other destinations as custom behavioural events. HubSpot
   records these only on plans that include them. Leave it off otherwise.
6. HubSpot's CSP hosts are wildcards (`*.hs-scripts.com`, `*.hs-analytics.net`,
   `*.hs-banner.com`, `*.hubspot.com`) because portals are served from regional hosts.

## Consent

The host normalises its banner's state into:

```ts
type ConsentState = { decided: boolean; analytics: boolean; marketing: boolean };
```

A destination is permitted when **both** its event's requirement (or the mapping's override)
**and** its provider's own requirement are met:

- `none` is always met.
- With **Consent required** off in the settings, every requirement is met.
- An undecided visitor is treated as denied, or granted if the settings say so.

Prohibited destinations are skipped and permitted ones continue. A change reaches the next
event and each adapter's `updateConsent` exactly once per real change. To run Google
Consent Mode in its *Advanced* form (tags always load, and consent only governs storage),
give the GTM destinations the requirement `none`. The adapter then carries the visitor's
choice into Consent Mode itself.

## Adding a provider

A worked example lives in [`examples/meta/`](examples/meta/). It is a Meta Pixel provider
that `tests/pipeline.test.ts` registers and drives end to end. To add one:

1. **Create the folder**, e.g. `providers/meta/`, with:
   - `config.ts`: a `ProviderDefinition` with its fields, `project()` publishing only
     what the browser needs, `csp` hosts, and optional name and settings validation.
   - `adapter.ts`: a factory returning an `AnalyticsProvider`. Take `{ host }` for
     testability. Load scripts in `initialize()` and only when `context.permitted`. Translate
     each `DispatchEvent` into the provider's own call.
   - `types.ts` and `csp.ts` as the built-ins do.
2. **Register the definition** with the plugin (`providers: [...builtInProviders(), metaProvider]`)
   and with the loader, then regenerate types. The settings gain a Meta tab, and events
   can map to `meta`.
3. **Register the adapter** with the runtime (`providers: [..., metaAdapter()]`).
4. **Allow its hosts** in your CSP.

The core, the dispatcher, and every `analytics.track(...)` call stay as they are.

## Versioning

The package follows semver. Its public API includes what it stores, not only what it
exports: the slugs `analytics-settings` and `analytics-events`, and every field name in
them, are covered too, since a host may read them straight from the database. Renaming one
is a breaking change. Before 1.0, a breaking change bumps the minor version.

## Testing

`tests/` holds the plugin's own suite. It runs on Node's test runner with `tsx`, against the
source rather than `dist/`, and needs no services and no network. It needs Node 22 or later.
From the repository root:

```sh
npm test -w packages/analytics
```

| File                     | Covers                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `plugin.test.ts`         | registration, the disabled mode, slugs, access, the host's settings hooks, duplicate providers, `onChange` on save, HubSpot's portal field and its rules, the preview, and a save checked against host-supplied values |
| `boundary.test.ts`       | the layering rules above, and no control characters in the source                      |
| `provider-registry.test.ts` | register, resolve, missing, disabled and duplicate providers                         |
| `validator.test.ts`      | valid, missing required, wrong type, extra field, empty optional; the privacy guard     |
| `conditions.test.ts`     | every operator, several conditions together, failure reasons, an invalid operator       |
| `consent.test.ts`        | analytics and marketing granted or denied, mixed destinations, a change mid-session     |
| `runtime.test.ts`        | valid, unknown, disabled and empty events, provider failure, ordering, mappings, `pageView` de-duplication |
| `logger.test.ts`         | debug on and off, validation, consent and provider failures, values withheld until validated |
| `config.test.ts`         | projection, secret exclusion, environment filtering, cache and invalidation, HubSpot's stored portal, `hubspotPortal()` and `hubspotPortalText()`, and host-supplied values (missing, failed read, re-read) |
| `adapters.test.ts`       | GTM, GA4 and HubSpot against a stub browser                                             |
| `pipeline.test.ts`       | the whole route from stored CMS data to each destination, the example provider included |

External services are always stubbed, so no test sends a real event. CRUD, validation and
access control against a running Payload belong to the host's integration suite.

## Troubleshooting

| Symptom                                   | Look at                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Nothing is sent at all                    | Is the `analytics-config` element in the page? Is `enabled` true there, with this environment ticked? `/api/analytics/preview?environment=…` shows what the server would publish and why a provider is off. |
| One event is missing                      | Turn **Debug mode** on (outside production). The console trace shows the registry match, validation, and each destination's result or skip reason. |
| A destination says `… consent not given`  | Both the event's (or mapping's) requirement and the provider's own must be met.                                                               |
| A parameter is missing                    | The trace's *Dropped parameters* says why: undeclared, wrong type, looks like an email or phone number, or too long. A required parameter of the wrong type refuses the whole event instead. |
| GA4 shows every event twice               | Something outside the plugin also sends to GA4 (a hard-coded gtag snippet, or a second container). The settings already refuse *Directly* with GTM on. |
| GTM ignores the consent default           | Something pushed an array instead of `arguments`. Only the GTM adapter should write to the dataLayer.                                         |
| HubSpot never loads                       | Its consent requirement is unmet, its tab holds no portal (or one that is not digits), or the CSP blocks its regional hosts. The preview's `skipped.hubspot` says which of the first two. |
| A settings change does not show           | The host's `onChange` must invalidate its loader and re-render. Otherwise it appears within the loader's `ttlMs` or the page's revalidation. |
