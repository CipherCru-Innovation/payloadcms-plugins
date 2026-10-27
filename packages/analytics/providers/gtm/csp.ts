import type { CspSources } from "../types.js";

/** gtm.js, and the preview frame Google lists for it. What the container loads is its tags' own. */
export const GTM_CSP: CspSources = {
  script: ["https://www.googletagmanager.com"],
  img: ["https://www.googletagmanager.com"],
  connect: ["https://www.googletagmanager.com"],
  frame: ["https://www.googletagmanager.com"],
};
