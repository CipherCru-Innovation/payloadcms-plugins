# @ciphercru/payload-analytics

## 0.1.0

First public release.

- **Payload side**: an Analytics Settings global (general rules plus a tab per provider) and
  an Analytics Events collection (the event registry). Validates IDs, keys, trigger types,
  destination names, conditions, aliases and sensitive parameter names. Adds a preview
  endpoint, host-supplied access and `onChange`, and a disabled mode that keeps the schema.
- **Host hooks on the settings global**: `hooks.settings` takes Payload hooks of any kind,
  typed `SettingsHooks`, each run after the plugin's own and added whether or not the plugin
  is enabled.
- **Server**: `projectConfig()`, an allowlist projection of the stored configuration into
  what the browser may know, plus a cached `createConfigLoader()` and `serializeConfig()`.
- **Runtime**: `track()` and `page()` through registry, validation and privacy guard,
  declarative conditions, a central consent gate, per-destination aliases and synchronous
  dispatch that never throws. A debug trace with masking.
- **Providers**: Google Tag Manager, Google Analytics 4 (direct or through GTM) and HubSpot,
  plus a worked Meta Pixel example under `examples/`. GA4 cannot be set to direct delivery
  while GTM is enabled.
- **HubSpot's portal** is a setting of the plugin, digits only and required while HubSpot is
  on. `hubspotPortal()` and `hubspotPortalText()` in `./server` read it for a host that sends
  anything else to HubSpot, such as form submissions, so the two cannot name different
  accounts.
- **Provider extension points**: `supply()` for host-owned values, a tab `description`, and
  `validateSettings` receiving the supplied values on save.
- **React binding**: `AnalyticsProvider` and `useAnalytics` from `./client/react`.
- Six entry points, ES modules with type declarations; Payload and React are peers.
