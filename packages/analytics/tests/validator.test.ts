import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { guardValue, validatePayload } from "../core/validator.js";
import { event, parameter } from "./support.js";

/* Only declared parameters of the declared type leave, each through the privacy guard. */

const definition = event({
  parameters: [
    parameter("form_location", { required: true }),
    parameter("service"),
    parameter("count", { type: "number" }),
    parameter("first", { type: "boolean" }),
    parameter("page_location", { format: "url", maxLength: 1000 }),
    parameter("page_title", { format: "title" }),
  ],
});

describe("payload validation", () => {
  it("passes a valid payload through unchanged", () => {
    const outcome = validatePayload(definition, { form_location: "footer", service: "web", count: 2, first: true }, "drop");
    assert.deepEqual(outcome, { ok: true, params: { form_location: "footer", service: "web", count: 2, first: true }, dropped: [] });
  });

  it("refuses the event when a required value is missing", () => {
    const outcome = validatePayload(definition, { service: "web" }, "drop");
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.reason : "", /missing required form_location/);
  });

  it("refuses the event when a required value has the wrong type", () => {
    const outcome = validatePayload(definition, { form_location: 42 }, "drop");
    assert.equal(outcome.ok, false);
    assert.match(!outcome.ok ? outcome.reason : "", /required form_location: expected a string/);
  });

  it("keeps the event when the privacy guard refuses a required value", () => {
    const outcome = validatePayload(definition, { form_location: "me@example.com" }, "drop");
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.params, {});
    assert.deepEqual(outcome.dropped.map((d) => d.name), ["form_location"]);
  });

  it("drops a value of the wrong type, and nested objects", () => {
    const outcome = validatePayload(definition, { form_location: "x", count: "2", service: { nested: true } }, "drop");
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.params, { form_location: "x" });
    assert.deepEqual(outcome.dropped.map((d) => d.name), ["count", "service"]);
  });

  it("drops an undeclared field, or refuses the event, as configured", () => {
    const dropped = validatePayload(definition, { form_location: "x", password: "hunter2" }, "drop");
    assert.ok(dropped.ok);
    assert.deepEqual(dropped.params, { form_location: "x" });
    assert.equal(validatePayload(definition, { form_location: "x", extra: 1 }, "reject").ok, false);
  });

  it("treats an absent optional value as absent, and keeps an empty string", () => {
    const outcome = validatePayload(definition, { form_location: "x", service: undefined, page_title: "" }, "drop");
    assert.ok(outcome.ok);
    assert.deepEqual(outcome.params, { form_location: "x", page_title: "" });
  });

  it("accepts an empty or missing payload for an event with no required parameters", () => {
    const optional = event({ parameters: [parameter("a")] });
    assert.deepEqual(validatePayload(optional, undefined, "drop"), { ok: true, params: {}, dropped: [] });
    assert.deepEqual(validatePayload(optional, {}, "drop"), { ok: true, params: {}, dropped: [] });
  });
});

describe("the privacy guard", () => {
  const text = parameter("value");
  it("refuses text that looks like an email address or a phone number", () => {
    assert.equal(guardValue(text, "me@example.com").ok, false);
    assert.equal(guardValue(text, "call 0123456789").ok, false);
  });

  it("refuses text over 100 characters unless told to truncate", () => {
    assert.equal(guardValue(text, "x".repeat(101)).ok, false);
    assert.deepEqual(guardValue({ ...text, truncate: true }, "x".repeat(101)), { ok: true, value: "x".repeat(100) });
  });

  it("truncates a title at 300 characters rather than refusing it", () => {
    assert.deepEqual(guardValue(parameter("t", { format: "title" }), "x".repeat(301)), { ok: true, value: "x".repeat(300) });
  });

  it("redacts email-like query values and credentials in a URL", () => {
    const url = parameter("u", { format: "url" });
    assert.deepEqual(guardValue(url, "https://user:pw@example.test/p?e=a@b.c&q=1"), {
      ok: true,
      value: "https://example.test/p?e=%5Bredacted%5D&q=1",
    });
    assert.equal(guardValue(url, "not a url").ok, false);
  });

  it("caps a URL at its declared length", () => {
    const url = parameter("u", { format: "url", maxLength: 30 });
    const outcome = guardValue(url, `https://example.test/${"a".repeat(50)}`);
    assert.ok(outcome.ok && String(outcome.value).length === 30);
  });
});
