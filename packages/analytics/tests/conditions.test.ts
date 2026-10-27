import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateConditions, isSupportedOperator } from "../core/conditions.js";
import type { Condition } from "../core/types.js";

/* Declarative rules on parameters and context, failing closed. */

const check = (conditions: Condition[], params = {}, context = {}) => evaluateConditions(conditions, params, context).ok;

describe("event conditions", () => {
  it("equals", () => {
    assert.ok(check([{ field: "formLocation", operator: "equals", value: "footer" }], { formLocation: "footer" }));
    assert.ok(!check([{ field: "formLocation", operator: "equals", value: "footer" }], { formLocation: "hero" }));
  });

  it("not equals, including an absent value", () => {
    assert.ok(check([{ field: "formLocation", operator: "not_equals", value: "footer" }], { formLocation: "hero" }));
    assert.ok(check([{ field: "formLocation", operator: "not_equals", value: "footer" }], {}));
    assert.ok(!check([{ field: "formLocation", operator: "not_equals", value: "footer" }], { formLocation: "footer" }));
  });

  it("exists, treating an empty string as absent", () => {
    assert.ok(check([{ field: "service", operator: "exists" }], { service: "web" }));
    assert.ok(!check([{ field: "service", operator: "exists" }], { service: "" }));
    assert.ok(!check([{ field: "service", operator: "exists" }], {}));
  });

  it("starts with, against a context fact", () => {
    assert.ok(check([{ field: "pagePath", operator: "starts_with", value: "/services/" }], {}, { pagePath: "/services/web" }));
    assert.ok(!check([{ field: "pagePath", operator: "starts_with", value: "/services/" }], {}, { pagePath: "/admin" }));
  });

  it("contains, on a number converted to text", () => {
    assert.ok(check([{ field: "count", operator: "contains", value: "4" }], { count: 42 }));
  });

  it("requires every condition to hold, and names the one that failed", () => {
    const outcome = evaluateConditions(
      [
        { field: "environment", operator: "equals", value: "production" },
        { field: "formLocation", operator: "equals", value: "footer" },
      ],
      { formLocation: "hero" },
      { environment: "production" },
    );
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.reason : "", /formLocation equals "footer"/);
  });

  it("fails closed on an operator it does not know", () => {
    const outcome = evaluateConditions([{ field: "a", operator: "matches" as never, value: ".*" }], { a: "x" }, {});
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.reason : "", /unsupported operator/);
    assert.equal(isSupportedOperator("matches"), false);
  });
});
