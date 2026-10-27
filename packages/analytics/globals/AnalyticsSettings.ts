import { ValidationError, type Field, type GlobalConfig, type Tab } from "payload";

import { CONSENT_REQUIREMENTS, ENVIRONMENTS } from "../core/types.js";
import type { ProviderDefinition, StoredProviderSettings } from "../providers/types.js";
import { notifyChange, type ResolvedOptions, type SettingsHooks } from "../plugin-options.js";
import { readSupplied } from "../server/config.js";

/**
 * One global for everything that applies across events: the master switch, where analytics
 * runs, how consent is treated, and a tab per provider. Every field says whether it is
 * rendered into public pages, because the IDs are and nothing secret may sit beside them.
 */

export const PUBLIC_NOTE = "Public: rendered into every page.";

const consentOptions = CONSENT_REQUIREMENTS.map((value) => ({
  value,
  label: value === "none" ? "None (always permitted)" : `${value[0]!.toUpperCase()}${value.slice(1)} consent`,
}));

const generalFields: Field[] = [
  {
    name: "enabled",
    type: "checkbox",
    label: "Analytics enabled",
    defaultValue: false,
    admin: { description: `Off sends nothing anywhere, whatever the events say. ${PUBLIC_NOTE}` },
  },
  {
    name: "environments",
    type: "select",
    hasMany: true,
    label: "Environments that send events",
    options: ENVIRONMENTS.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
    defaultValue: ["production"],
    admin: {
      description:
        "Production tracking is enabled by ticking Production. Development and staging only send " +
        "when ticked here, so test traffic never reaches production reports by default.",
    },
  },
  {
    name: "debug",
    type: "checkbox",
    label: "Debug mode",
    defaultValue: false,
    admin: {
      description:
        "Logs each event's route through validation, consent and every provider to the browser " +
        "console. Ignored in production, so nothing there can depend on it.",
    },
  },
  {
    type: "row",
    fields: [
      {
        name: "consentRequired",
        type: "checkbox",
        label: "Consent required",
        defaultValue: true,
        admin: { description: "Off treats every destination as permitted." },
      },
      {
        name: "whenUndecided",
        type: "select",
        label: "Before the visitor answers",
        defaultValue: "denied",
        options: [
          { value: "denied", label: "Treat consent as denied" },
          { value: "granted", label: "Treat consent as granted" },
        ],
      },
    ],
  },
  {
    name: "unknownParameters",
    type: "select",
    label: "Undeclared parameters",
    defaultValue: "drop",
    options: [
      { value: "drop", label: "Drop the parameter, send the event" },
      { value: "reject", label: "Refuse the whole event" },
    ],
    admin: { description: "What happens to a parameter an event's definition does not list." },
  },
];

function providerTab(provider: ProviderDefinition): Tab {
  return {
    name: provider.id,
    label: provider.label,
    ...(provider.description ? { admin: { description: provider.description } } : {}),
    fields: [
      {
        type: "row",
        fields: [
          { name: "enabled", type: "checkbox", label: `${provider.label} enabled`, defaultValue: false },
          { name: "debug", type: "checkbox", label: "Debug mode", defaultValue: false },
          {
            name: "consent",
            type: "select",
            label: "Consent this destination needs",
            options: consentOptions,
            defaultValue: provider.defaultConsent,
            required: true,
          },
        ],
      },
      ...provider.fields,
    ],
  };
}

/** The plugin's own hooks with the host's appended, so of each kind the plugin's run first. */
function appendHostHooks(host: SettingsHooks, own: SettingsHooks): SettingsHooks {
  const merged: Record<string, unknown[] | undefined> = { ...own };
  for (const [kind, hooks] of Object.entries(host)) merged[kind] = [...(merged[kind] ?? []), ...(hooks ?? [])];
  return merged as SettingsHooks;
}

export function analyticsSettingsGlobal(options: ResolvedOptions): GlobalConfig {
  const { providers } = options;
  const reserved = new Set(["enabled", "environments", "debug", "consentRequired", "whenUndecided", "unknownParameters"]);
  for (const provider of providers) {
    if (reserved.has(provider.id)) throw new Error(`Analytics provider id "${provider.id}" clashes with a settings field.`);
  }

  return {
    slug: options.slugs.settings,
    label: "Analytics Settings",
    admin: {
      group: options.adminGroup,
      description:
        "Where analytics is sent and on what terms. Which events exist, and what each provider " +
        "calls them, is in Analytics Events.",
    },
    access: { read: options.access.settings.read, update: options.access.settings.update },
    versions: { max: 20, drafts: false },
    hooks: appendHostHooks(options.hooks.settings, {
      beforeValidate: [
        async ({ data, req }) => {
          if (!data) return data;
          const all = Object.fromEntries(
            providers.map((provider) => [provider.id, (data[provider.id] ?? {}) as StoredProviderSettings]),
          );
          /* The host is asked only for providers being saved switched on. */
          const supplied = await readSupplied(providers.filter((provider) => all[provider.id]!.enabled === true));
          const errors = providers.flatMap((provider) => {
            const result = provider.validateSettings?.(all[provider.id]!, all, supplied[provider.id]) ?? true;
            return result === true ? [] : [{ path: provider.id, message: result }];
          });
          if (errors.length) throw new ValidationError({ global: options.slugs.settings, errors, req });
          return data;
        },
      ],
      afterChange: options.enabled
        ? [
            async ({ doc, req }) => {
              await notifyChange(options, req.payload);
              return doc;
            },
          ]
        : [],
    }),
    fields: [
      {
        type: "tabs",
        tabs: [{ label: "General", fields: generalFields }, ...providers.map(providerTab)],
      },
    ],
  };
}
