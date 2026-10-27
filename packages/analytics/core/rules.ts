/**
 * Naming and privacy rules shared by the CMS schema and the runtime, so a value the admin
 * accepts is one the runtime can use.
 */

/** Lowercase snake_case, starting with a letter: `contact_form_submit`. */
export const EVENT_KEY = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** Parameter and condition field names: `form_location` or `formLocation`. */
export const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** What a destination may be told an event is called. */
export const DESTINATION_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

/**
 * Names that suggest a secret or a person's own words. Refused as parameters unless an
 * administrator records that the parameter was reviewed.
 */
const SENSITIVE_NAME =
  /pass(?:word|wd|code)|(?:^|_)otp(?:$|_)|token|secret|api_?key|cvv|card_?number|(?:^|_)ssn(?:$|_)|message|^e?mail(?:_?address)?$|^phone(?:_?number)?$|^(?:first|last|full)_?name$/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name);
}

export function validateEventKey(key: unknown, providerIds: readonly string[]): true | string {
  if (typeof key !== "string" || !EVENT_KEY.test(key)) {
    return "Use lowercase snake_case starting with a letter, for example contact_form_submit.";
  }
  const provider = providerIds.find((id) => key === id || key.startsWith(`${id}_`));
  if (provider) {
    return `An internal key describes what happened, not where it is sent: drop the "${provider}" prefix.`;
  }
  return true;
}
