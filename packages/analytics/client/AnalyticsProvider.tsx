"use client";

import { useEffect, type ReactNode } from "react";

import type { ConsentState } from "../core/types.js";
import { AnalyticsContext } from "./AnalyticsContext.js";
import { installedAnalytics } from "./runtime.js";
import { analytics } from "./track.js";

/**
 * Starts the installed runtime after hydration and keeps it told of the visitor's consent.
 * Installing is the host's job, before hydration, because some providers need their consent
 * default in place before any script loads.
 */
export function AnalyticsProvider({
  consent,
  measured = true,
  children,
}: {
  /** Undefined while the host cannot read consent yet (for example during SSR). */
  consent: ConsentState | undefined;
  measured?: boolean;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (measured) installedAnalytics()?.start();
  }, [measured]);

  useEffect(() => {
    if (consent) installedAnalytics()?.setConsent(consent);
  }, [consent]);

  return <AnalyticsContext.Provider value={analytics}>{children}</AnalyticsContext.Provider>;
}
