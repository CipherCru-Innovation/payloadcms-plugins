import { isSensitiveName } from "./rules.js";
import type { ParameterValue } from "./types.js";

/**
 * The debug trace: one collapsed console group per event, saying what was received, how it
 * was validated, and what each destination did with it and why. A received value is shown
 * only once validation has let it through; the rest are named but withheld, even in a trace.
 */

export type ProviderOutcome = {
  provider: string;
  eventName?: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
  params?: Readonly<Record<string, ParameterValue>>;
};

export type EventTrace = {
  event: string;
  received: Readonly<Record<string, unknown>>;
  registry: "matched" | "unknown" | "disabled" | "environment";
  validation?: {
    ok: boolean;
    reason?: string;
    params?: Readonly<Record<string, ParameterValue>>;
    dropped: readonly { name: string; reason: string }[];
  };
  consent?: Readonly<Record<string, boolean>>;
  providers: ProviderOutcome[];
  ignored?: string;
};

export type Sink = Pick<Console, "groupCollapsed" | "groupEnd" | "log" | "warn">;

export type Logger = {
  readonly enabled: boolean;
  event(trace: EventTrace): void;
  note(message: string, detail?: unknown): void;
};

export function maskValues<T>(values: Readonly<Record<string, T>>): Record<string, T | "[masked]"> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, isSensitiveName(name) ? "[masked]" : value]),
  );
}

/** What was received, with only the values validation accepted; nothing else is printed. */
function receivedPayload(trace: EventTrace): Record<string, unknown> {
  const accepted = trace.validation?.params ?? {};
  return maskValues(
    Object.fromEntries(
      Object.keys(trace.received).map((name) => [name, name in accepted ? accepted[name] : "[withheld]"]),
    ),
  );
}

function summarise(trace: EventTrace): string {
  if (trace.ignored) return `${trace.event}: ignored (${trace.ignored})`;
  const sent = trace.providers.filter((outcome) => outcome.status === "sent").map((o) => `${o.provider} → ${o.eventName}`);
  return `${trace.event}: ${sent.length ? sent.join(", ") : "sent nowhere"}`;
}

export function createLogger(enabled: boolean, sink: Sink = console): Logger {
  return {
    enabled,
    event(trace) {
      if (!enabled) return;
      try {
        sink.groupCollapsed(`[analytics] ${summarise(trace)}`);
        sink.log("Event", trace.event);
        sink.log("Payload", receivedPayload(trace));
        sink.log("Registry", trace.registry);
        if (trace.validation) {
          sink.log("Validation", trace.validation.ok ? "passed" : `failed: ${trace.validation.reason}`);
          if (trace.validation.dropped.length) sink.warn("Dropped parameters", trace.validation.dropped);
        }
        if (trace.consent) sink.log("Consent", trace.consent);
        for (const outcome of trace.providers) {
          const line = `${outcome.provider}: ${outcome.eventName ?? "-"} → ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}`;
          if (outcome.status === "failed") sink.warn(line);
          else sink.log(line, outcome.params ? maskValues(outcome.params) : "");
        }
        sink.groupEnd();
      } catch {
        /* A console that throws must not reach the page. */
      }
    },
    note(message, detail) {
      if (!enabled) return;
      try {
        sink.log(`[analytics] ${message}`, ...(detail === undefined ? [] : [detail]));
      } catch {
        /* As above. */
      }
    },
  };
}
