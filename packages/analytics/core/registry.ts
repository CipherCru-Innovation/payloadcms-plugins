import type { EventDefinition } from "./types.js";

/**
 * The event registry as the runtime holds it: the definitions the CMS published, looked up
 * by internal key. The public projection has already left out disabled events and those
 * outside this environment, so a key that is absent here is either unknown or off.
 */
export type EventRegistry = {
  lookup(key: string): EventDefinition | undefined;
  keys(): string[];
};

export function createEventRegistry(events: readonly EventDefinition[]): EventRegistry {
  const byKey = new Map<string, EventDefinition>();
  for (const event of events) if (!byKey.has(event.key)) byKey.set(event.key, event);
  return {
    lookup: (key) => byKey.get(key),
    keys: () => [...byKey.keys()],
  };
}
