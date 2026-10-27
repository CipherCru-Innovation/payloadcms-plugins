import type {
  EventDefinition,
  EventPayload,
  ParameterDefinition,
  ParameterValue,
  UnknownParameterPolicy,
} from "./types.js";

/**
 * Checks a payload against its event's declared parameters. Only declared parameters of
 * the declared type leave, and each passes a privacy guard first: a URL keeps its shape but
 * loses email-like query values, and text that looks like an address or a phone number is
 * refused. Nested values are never accepted.
 */

export type Dropped = { name: string; reason: string };

export type ValidationOutcome =
  | { ok: true; params: Record<string, ParameterValue>; dropped: Dropped[] }
  | { ok: false; reason: string; dropped: Dropped[] };

const DEFAULT_LENGTH = { text: 100, title: 300, url: 1000 } as const;

const EMAIL_LIKE = /@/;
const LONG_DIGIT_RUN = /\d{7,}/;

type Guarded = { ok: true; value: ParameterValue } | { ok: false; reason: string; wrongType?: true };

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.forEach((value, key) => {
      if (EMAIL_LIKE.test(value)) url.searchParams.set(key, "[redacted]");
    });
    /* Credentials in a URL are never measurement data. */
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function guardValue(definition: ParameterDefinition, value: unknown): Guarded {
  if (definition.type === "boolean") {
    return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "expected a boolean", wrongType: true };
  }
  if (definition.type === "number") {
    if (typeof value !== "number") return { ok: false, reason: "expected a number", wrongType: true };
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: "not a finite number" };
  }
  if (typeof value !== "string") return { ok: false, reason: `expected a string, got ${typeof value}`, wrongType: true };

  const limit = definition.maxLength ?? DEFAULT_LENGTH[definition.format];

  if (definition.format === "url") {
    const url = redactUrl(value);
    return url ? { ok: true, value: url.slice(0, limit) } : { ok: false, reason: "not a valid URL" };
  }

  if (EMAIL_LIKE.test(value)) return { ok: false, reason: "looks like an email address" };
  if (LONG_DIGIT_RUN.test(value)) return { ok: false, reason: "contains a run of 7+ digits" };

  if (value.length > limit) {
    return definition.format === "title" || definition.truncate
      ? { ok: true, value: value.slice(0, limit) }
      : { ok: false, reason: `longer than ${limit} characters` };
  }
  return { ok: true, value };
}

/**
 * `required` means the site must supply a value of the declared type; the wrong type is a
 * bug in the caller, so the event is refused. A value the privacy guard refuses is dropped,
 * not the whole event: the event still describes what happened.
 */
export function validatePayload(
  definition: EventDefinition,
  payload: EventPayload | undefined,
  policy: UnknownParameterPolicy,
): ValidationOutcome {
  const input: EventPayload =
    payload !== null && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const declared = new Map(definition.parameters.map((parameter) => [parameter.name, parameter]));
  const params: Record<string, ParameterValue> = {};
  const dropped: Dropped[] = [];

  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const parameter = declared.get(name);
    if (!parameter) {
      if (policy === "reject") {
        return { ok: false, reason: `"${name}" is not a parameter of ${definition.key}`, dropped };
      }
      dropped.push({ name, reason: `not a parameter of ${definition.key}` });
      continue;
    }
    const guarded = guardValue(parameter, value);
    if (guarded.ok) params[name] = guarded.value;
    else if (parameter.required && guarded.wrongType) {
      return { ok: false, reason: `required ${name}: ${guarded.reason}`, dropped };
    } else dropped.push({ name, reason: guarded.reason });
  }

  const missing = definition.parameters
    .filter((parameter) => parameter.required && (input[parameter.name] === undefined || input[parameter.name] === null))
    .map((parameter) => parameter.name);
  if (missing.length) return { ok: false, reason: `missing required ${missing.join(", ")}`, dropped };

  return { ok: true, params, dropped };
}
