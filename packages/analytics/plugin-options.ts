import type { Access, GlobalConfig, Payload } from "payload";

import type { ProviderDefinition } from "./providers/types.js";

export type AnalyticsPluginOptions = {
  /**
   * False keeps the global and the collection registered, so stored configuration and the
   * database schema survive, but adds no hooks or endpoints.
   */
  enabled?: boolean;
  /** The destinations the CMS can configure. Their order is the settings tabs' order. */
  providers: readonly ProviderDefinition[];
  access?: {
    settings?: { read?: Access; update?: Access };
    events?: { read?: Access; create?: Access; update?: Access; delete?: Access };
  };
  /** The admin sidebar heading. */
  adminGroup?: string;
  slugs?: { settings?: string; events?: string };
  /**
   * Called after any analytics configuration changes, for the host to drop its cached copy.
   * A failure is logged and never undoes the save.
   */
  onChange?: (args: { payload: Payload }) => void | Promise<void>;
  /**
   * The host's own hooks on the settings global, each kind run after the plugin's, such as a
   * rule guarding a value the host also reads. Added whether or not the plugin is enabled.
   */
  hooks?: { settings?: SettingsHooks };
};

export type SettingsHooks = NonNullable<GlobalConfig["hooks"]>;

export type ResolvedOptions = {
  enabled: boolean;
  providers: readonly ProviderDefinition[];
  access: {
    settings: { read: Access; update: Access };
    events: { read: Access; create: Access; update: Access; delete: Access };
  };
  adminGroup: string;
  slugs: { settings: string; events: string };
  onChange?: AnalyticsPluginOptions["onChange"];
  hooks: { settings: SettingsHooks };
};

export const DEFAULT_SLUGS = { settings: "analytics-settings", events: "analytics-events" } as const;

/** Signed-in users only, until the host says otherwise. */
const signedIn: Access = ({ req }) => Boolean(req.user);

export function resolveOptions(options: AnalyticsPluginOptions): ResolvedOptions {
  const ids = options.providers.map((provider) => provider.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`Analytics provider "${duplicate}" is registered twice.`);

  return {
    enabled: options.enabled ?? true,
    providers: options.providers,
    access: {
      settings: {
        read: options.access?.settings?.read ?? signedIn,
        update: options.access?.settings?.update ?? signedIn,
      },
      events: {
        read: options.access?.events?.read ?? signedIn,
        create: options.access?.events?.create ?? signedIn,
        update: options.access?.events?.update ?? signedIn,
        delete: options.access?.events?.delete ?? signedIn,
      },
    },
    adminGroup: options.adminGroup ?? "Analytics",
    slugs: { ...DEFAULT_SLUGS, ...options.slugs },
    onChange: options.onChange,
    hooks: { settings: options.hooks?.settings ?? {} },
  };
}

/** Runs the host's `onChange` without letting it fail a save. */
export async function notifyChange(options: ResolvedOptions, payload: Payload): Promise<void> {
  if (!options.enabled || !options.onChange) return;
  try {
    await options.onChange({ payload });
  } catch (error) {
    payload.logger.error(
      `Analytics configuration saved, but the site's copy was not refreshed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
