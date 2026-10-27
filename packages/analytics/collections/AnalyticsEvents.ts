import { ValidationError, type CollectionConfig, type Field } from "payload";

import {
  DESTINATION_EVENT_NAME,
  PARAMETER_NAME,
  isSensitiveName,
  validateEventKey,
} from "../core/rules.js";
import {
  CONDITION_OPERATORS,
  CONSENT_REQUIREMENTS,
  ENVIRONMENTS,
  PARAMETER_TYPES,
  TRIGGER_TYPES,
} from "../core/types.js";
import { notifyChange, type ResolvedOptions } from "../plugin-options.js";

/**
 * The event registry: one record per thing the site can report. The site tracks the
 * internal key; everything a destination sees — its name for the event, which parameters,
 * under what names and on what conditions — is data here, so changing it needs no deploy.
 */

const label = (value: string) => value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const optionsOf = (values: readonly string[]) => values.map((value) => ({ value, label: label(value) }));

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

const parameterName = (value: unknown) =>
  typeof value === "string" && PARAMETER_NAME.test(value)
    ? true
    : "Letters, digits and underscores, starting with a letter, at most 40 characters.";

/**
 * Checks that span rows, which a single field's `validate` cannot see: duplicate parameter
 * names, aliases of undeclared parameters, and names that suggest personal data.
 */
function crossFieldErrors(data: Row, options: ResolvedOptions): { path: string; message: string }[] {
  const errors: { path: string; message: string }[] = [];
  const parameters = rows(data.parameters);
  const declared = new Set<string>();

  parameters.forEach((parameter, index) => {
    const name = String(parameter.name ?? "");
    if (declared.has(name)) errors.push({ path: `parameters.${index}.name`, message: `"${name}" is declared twice.` });
    declared.add(name);
    if (isSensitiveName(name) && !parameter.reviewed) {
      errors.push({
        path: `parameters.${index}.reviewed`,
        message:
          `"${name}" looks like a secret or personal data. Record that it was reviewed before it ` +
          "may leave the site.",
      });
    }
  });

  rows(data.mappings).forEach((mapping, index) => {
    const provider = options.providers.find((definition) => definition.id === mapping.provider);
    const nameCheck = provider?.validateEventName?.(String(mapping.eventName ?? "")) ?? true;
    if (nameCheck !== true) errors.push({ path: `mappings.${index}.eventName`, message: nameCheck });

    rows(mapping.aliases).forEach((alias, aliasIndex) => {
      if (!declared.has(String(alias.parameter ?? ""))) {
        errors.push({
          path: `mappings.${index}.aliases.${aliasIndex}.parameter`,
          message: `"${String(alias.parameter)}" is not one of this event's parameters.`,
        });
      }
    });
  });

  return errors;
}

const parameterFields: Field[] = [
  {
    type: "row",
    fields: [
      { name: "name", type: "text", required: true, validate: parameterName, admin: { width: "30%" } },
      { name: "type", type: "select", required: true, defaultValue: "string", options: optionsOf(PARAMETER_TYPES) },
      {
        name: "format",
        type: "select",
        required: true,
        defaultValue: "text",
        options: [
          { value: "text", label: "Text (refused if it looks personal)" },
          { value: "url", label: "URL (email-like query values redacted)" },
          { value: "title", label: "Title (cut to length, never refused)" },
        ],
        admin: { condition: (_, sibling) => sibling?.type === "string" },
      },
    ],
  },
  {
    type: "row",
    fields: [
      { name: "required", type: "checkbox", defaultValue: false, admin: { description: "Refuse the event without it." } },
      {
        name: "maxLength",
        type: "number",
        min: 1,
        max: 1000,
        admin: { description: "Characters. Blank means 100 (text) or 300 (title).", condition: (_, s) => s?.type === "string" },
      },
      {
        name: "truncate",
        type: "checkbox",
        defaultValue: false,
        admin: { description: "Cut to length rather than drop.", condition: (_, s) => s?.type === "string" },
      },
      {
        name: "reviewed",
        type: "checkbox",
        label: "Reviewed for personal data",
        defaultValue: false,
        admin: { description: "Needed only for names such as email, phone, message or token." },
      },
    ],
  },
];

const conditionFields: Field[] = [
  {
    type: "row",
    fields: [
      {
        name: "field",
        type: "text",
        required: true,
        validate: parameterName,
        admin: { description: "A parameter, or pagePath / environment." },
      },
      { name: "operator", type: "select", required: true, options: optionsOf(CONDITION_OPERATORS) },
      {
        name: "value",
        type: "text",
        validate: (value: unknown, { siblingData }: { siblingData: Row }) =>
          siblingData?.operator === "exists" || (typeof value === "string" && value !== "")
            ? true
            : "Every operator but Exists compares against a value.",
        admin: { condition: (_, sibling) => sibling?.operator !== "exists" },
      },
    ],
  },
];

export function analyticsEventsCollection(options: ResolvedOptions): CollectionConfig {
  const providerIds = options.providers.map((provider) => provider.id);
  const refresh = async <T>({ doc, req }: { doc: T; req: { payload: Parameters<typeof notifyChange>[1] } }) => {
    await notifyChange(options, req.payload);
    return doc;
  };

  return {
    slug: options.slugs.events,
    /* A host may read this with the plain driver, and mongoose would pluralise an unpinned name. */
    dbName: options.slugs.events,
    labels: { singular: "Analytics Event", plural: "Analytics Events" },
    admin: {
      group: options.adminGroup,
      useAsTitle: "displayName",
      defaultColumns: ["displayName", "eventKey", "triggerType", "enabled", "destinations", "consent", "environments"],
      listSearchableFields: ["displayName", "eventKey", "category"],
      description:
        "Every event the site can report. The site sends the internal key; each destination " +
        "receives the name and parameters set under Destinations.",
    },
    access: options.access.events,
    hooks: {
      beforeValidate: [
        ({ data, req }) => {
          if (!data) return data;
          const errors = crossFieldErrors(data, options);
          if (errors.length) throw new ValidationError({ collection: options.slugs.events, errors, req });
          return data;
        },
      ],
      afterChange: options.enabled ? [refresh] : [],
      afterDelete: options.enabled ? [refresh] : [],
    },
    fields: [
      {
        type: "row",
        fields: [
          {
            name: "displayName",
            type: "text",
            required: true,
            label: "Display name",
            admin: { description: "How people refer to it, e.g. Contact form submitted. Never sent anywhere." },
          },
          {
            name: "eventKey",
            type: "text",
            required: true,
            unique: true,
            index: true,
            label: "Internal event key",
            validate: (value: unknown) => validateEventKey(value, providerIds),
            admin: {
              description:
                "What the site's code sends, e.g. contact_form_submit. Keep it stable once " +
                "deployed: renaming it silently stops the event.",
            },
          },
        ],
      },
      {
        name: "description",
        type: "textarea",
        admin: { description: "When the site sends it, for the next person to edit it. Never sent anywhere." },
      },
      {
        type: "row",
        fields: [
          {
            name: "category",
            type: "text",
            validate: (value: unknown) =>
              value == null || value === "" || (typeof value === "string" && /^[a-z][a-z0-9_]*$/.test(value))
                ? true
                : "Lowercase snake_case, e.g. lead.",
            admin: { description: "A grouping for people, e.g. lead, engagement, navigation." },
          },
          {
            name: "triggerType",
            type: "select",
            required: true,
            label: "Trigger type",
            options: optionsOf(TRIGGER_TYPES),
            admin: {
              description:
                "Describes the event. Page view events go to each provider's page tracking. The site " +
                "still decides the moment it fires.",
            },
          },
          {
            name: "enabled",
            type: "checkbox",
            defaultValue: true,
            admin: { description: "Off keeps the record but nothing is sent." },
          },
        ],
      },
      {
        type: "row",
        fields: [
          {
            name: "environments",
            type: "select",
            hasMany: true,
            label: "Allowed environments",
            options: optionsOf(ENVIRONMENTS),
            admin: { description: "Blank means wherever analytics runs (Analytics Settings)." },
          },
          {
            name: "consent",
            type: "select",
            required: true,
            defaultValue: "analytics",
            label: "Consent requirement",
            options: optionsOf(CONSENT_REQUIREMENTS),
            admin: { description: "A destination may override this. Its own requirement applies as well." },
          },
        ],
      },
      {
        name: "parameters",
        type: "array",
        label: "Parameters",
        labels: { singular: "Parameter", plural: "Parameters" },
        admin: {
          description:
            "The approved parameters. Anything else the site passes is dropped or refused (Analytics " +
            "Settings), so nothing unreviewed can leave.",
          initCollapsed: true,
        },
        fields: parameterFields,
      },
      {
        name: "mappings",
        type: "array",
        label: "Destinations",
        labels: { singular: "Destination", plural: "Destinations" },
        admin: { description: "One row per provider that should receive this event." },
        fields: [
          {
            type: "row",
            fields: [
              {
                name: "provider",
                type: "select",
                required: true,
                options: options.providers.map((provider) => ({ value: provider.id, label: provider.label })),
              },
              {
                name: "eventName",
                type: "text",
                required: true,
                label: "Event name at the destination",
                validate: (value: unknown) =>
                  typeof value === "string" && DESTINATION_EVENT_NAME.test(value)
                    ? true
                    : "Letters, digits, underscores, dots and dashes, starting with a letter.",
              },
              { name: "enabled", type: "checkbox", defaultValue: true },
              {
                name: "consent",
                type: "select",
                defaultValue: "inherit",
                label: "Consent override",
                options: [{ value: "inherit", label: "As the event" }, ...optionsOf(CONSENT_REQUIREMENTS)],
              },
            ],
          },
          {
            name: "aliases",
            type: "array",
            label: "Parameter names at the destination",
            admin: { description: "Rename a parameter for this destination only.", initCollapsed: true },
            fields: [
              {
                type: "row",
                fields: [
                  { name: "parameter", type: "text", required: true, validate: parameterName },
                  { name: "alias", type: "text", required: true, validate: parameterName },
                ],
              },
            ],
          },
          {
            name: "conditions",
            type: "array",
            label: "Send only when",
            admin: { description: "Every condition must hold. Blank means always.", initCollapsed: true },
            fields: conditionFields,
          },
        ],
      },
      {
        name: "destinations",
        type: "text",
        virtual: true,
        label: "Destinations",
        /* A list column only: the edit view already shows the rows it summarises. */
        admin: { readOnly: true, condition: () => false },
        hooks: {
          afterRead: [
            ({ siblingData }) =>
              rows(siblingData?.mappings)
                .map((mapping) => `${String(mapping.provider)}: ${String(mapping.eventName)}${mapping.enabled === false ? " (off)" : ""}`)
                .join(" · ") || "None",
          ],
        },
      },
      { name: "debugNotes", type: "textarea", label: "Debug notes", admin: { description: "For whoever checks this event in a provider's debug view." } },
    ],
  };
}
