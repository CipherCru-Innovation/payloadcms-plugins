import type { Config, Plugin } from "payload";

import { analyticsEventsCollection } from "./collections/AnalyticsEvents.js";
import { analyticsSettingsGlobal } from "./globals/AnalyticsSettings.js";
import { resolveOptions, type AnalyticsPluginOptions } from "./plugin-options.js";
import { previewEndpoint } from "./server/endpoints.js";

/**
 * Registers the Analytics Settings global and the Analytics Events collection. Disabled, both stay
 * registered with their validation hooks and the host's `hooks`, so the schema, anything stored and
 * its rules survive; only the `onChange` hooks and the preview endpoint are left out.
 */
export function analyticsPlugin(pluginOptions: AnalyticsPluginOptions): Plugin {
  const options = resolveOptions(pluginOptions);

  return (config: Config): Config => ({
    ...config,
    collections: [...(config.collections ?? []), analyticsEventsCollection(options)],
    globals: [...(config.globals ?? []), analyticsSettingsGlobal(options)],
    endpoints: options.enabled ? [...(config.endpoints ?? []), previewEndpoint(options)] : config.endpoints,
  });
}
