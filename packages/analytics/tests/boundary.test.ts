import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/*
 * The plugin stands alone in any Payload project: no host alias, no host name, and no
 * Payload at runtime in the code a browser or a public route loads.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return ["node_modules", "dist"].includes(name) ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const files = sources(root).filter((file) => !file.includes(`${path.sep}tests${path.sep}`));
const relative = (file: string) => path.relative(root, file);

/* Code a browser or a public route imports: core, client, providers (bar the definitions,
   which only type-import Payload), csp, server. */
const RUNTIME = /^(core|client|server|providers)\/|^csp\.ts$/;
const RUNTIME_PAYLOAD_IMPORT = /^\s*import\s+(?!type\b)[^;]*from\s+["'](payload|@payloadcms\/[^"']+)["']/m;

describe("the plugin's boundaries", () => {
  it("never imports the host's @/ alias", () => {
    const offenders = files.filter((file) => /from\s+["']@\//.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map(relative), []);
  });

  it("never names the host site", () => {
    const offenders = files.filter((file) => /ciphercru/i.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map(relative), []);
  });

  it("keeps Payload out of runtime code except as types", () => {
    const offenders = files
      .filter((file) => RUNTIME.test(relative(file)) && !relative(file).startsWith("server/endpoints"))
      .filter((file) => RUNTIME_PAYLOAD_IMPORT.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map(relative), []);
  });

  it("keeps provider names out of the core", () => {
    const offenders = files
      .filter((file) => relative(file).startsWith("core/"))
      .filter((file) => /\b(ga4|gtm|hubspot|gtag|dataLayer|_hsq)\b/i.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map(relative), []);
  });

  it("holds no control characters or raw line separators", () => {
    const codes = [...Array(32).keys()].filter((code) => ![9, 10, 13].includes(code)).concat([0x2028, 0x2029]);
    const forbidden = new RegExp(`[${codes.map((code) => String.fromCharCode(code)).join("")}]`);
    const offenders = files.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map(relative), []);
  });
});
