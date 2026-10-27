import type { Endpoint, PayloadRequest } from "payload";

import { ENVIRONMENTS, type Environment } from "../core/types.js";
import type { ResolvedOptions } from "../plugin-options.js";
import { projectConfig, readSupplied } from "./config.js";

/**
 * `GET /api/analytics/preview?environment=staging`: the public configuration exactly as a
 * page in that environment would receive it, plus the providers left off and why. For
 * administrators checking a change, so it answers only to those who may read the settings.
 */
export function previewEndpoint(options: ResolvedOptions): Endpoint {
  return {
    path: "/analytics/preview",
    method: "get",
    handler: async (req: PayloadRequest) => {
      const allowed = await options.access.settings.read({ req });
      if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

      const requested = new URL(req.url ?? "http://localhost").searchParams.get("environment");
      const environment: Environment = ENVIRONMENTS.includes(requested as Environment)
        ? (requested as Environment)
        : "production";

      /* Slugs are the host's to choose, so they are not in any generated type the plugin can name. */
      const [settings, events, supplied] = await Promise.all([
        req.payload.findGlobal({ slug: options.slugs.settings as never, depth: 0, overrideAccess: true }),
        req.payload.find({
          collection: options.slugs.events as never,
          depth: 0,
          limit: 0,
          pagination: false,
          overrideAccess: true,
        }),
        readSupplied(options.providers),
      ]);

      return Response.json(
        projectConfig({
          settings: settings as unknown as Record<string, unknown>,
          events: events.docs as unknown as Record<string, unknown>[],
          providers: options.providers,
          environment,
          supplied,
        }),
      );
    },
  };
}
