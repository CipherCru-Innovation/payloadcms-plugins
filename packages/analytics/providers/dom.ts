/**
 * The browser globals adapters touch, passed in rather than read from `window` directly so a
 * test can hand them a stub. Shared by adapters; nothing here knows a provider.
 */
export type BrowserHost = {
  window: Window & Record<string, unknown>;
  document: Document;
};

export function browserHost(): BrowserHost | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return { window: window as unknown as BrowserHost["window"], document };
}

/** Appends an async script once per `id`; a second call with the same id does nothing. */
export function injectScript(
  host: BrowserHost,
  { id, src, onError }: { id: string; src: string; onError?: () => void },
): boolean {
  if (host.document.getElementById(id)) return false;
  const script = host.document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  if (onError) script.addEventListener("error", onError);
  (host.document.head ?? host.document.body).appendChild(script);
  return true;
}

/** A queue the provider's script replays, created on first use. */
export function queue<T = unknown>(host: BrowserHost, name: string): T[] {
  const existing = host.window[name];
  if (Array.isArray(existing)) return existing as T[];
  const created: T[] = [];
  host.window[name] = created;
  return created;
}
