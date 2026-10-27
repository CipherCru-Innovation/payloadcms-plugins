import { CONDITION_OPERATORS, type Condition, type ConditionOperator, type ParameterValue } from "./types.js";

/**
 * Declarative routing rules. Each operator is a fixed comparison on strings; there is no
 * expression language, and an operator this code does not know fails closed.
 */

export type ConditionFacts = Readonly<Record<string, ParameterValue | undefined>>;

export type ConditionOutcome = { ok: true } | { ok: false; failed: Condition; reason: string };

export function isSupportedOperator(operator: unknown): operator is ConditionOperator {
  return typeof operator === "string" && (CONDITION_OPERATORS as readonly string[]).includes(operator);
}

function holds(condition: Condition, actual: ParameterValue | undefined): boolean {
  const present = actual !== undefined && actual !== "";
  const value = present ? String(actual) : "";
  const expected = condition.value ?? "";
  switch (condition.operator) {
    case "exists":
      return present;
    case "equals":
      return present && value === expected;
    case "not_equals":
      return value !== expected;
    case "starts_with":
      return present && value.startsWith(expected);
    case "contains":
      return present && value.includes(expected);
    default:
      return false;
  }
}

/** Every condition must hold. Parameters are looked up first, then the context facts. */
export function evaluateConditions(
  conditions: readonly Condition[],
  params: ConditionFacts,
  context: ConditionFacts,
): ConditionOutcome {
  for (const condition of conditions) {
    if (!isSupportedOperator(condition.operator)) {
      return { ok: false, failed: condition, reason: `unsupported operator "${String(condition.operator)}"` };
    }
    const actual = Object.prototype.hasOwnProperty.call(params, condition.field)
      ? params[condition.field]
      : context[condition.field];
    if (!holds(condition, actual)) {
      const target = condition.operator === "exists" ? "" : ` "${condition.value ?? ""}"`;
      return { ok: false, failed: condition, reason: `${condition.field} ${condition.operator}${target} did not hold` };
    }
  }
  return { ok: true };
}
