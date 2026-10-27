"use client";

import { createContext, useContext } from "react";

import { analytics } from "./track.js";

/**
 * For components that prefer a hook to an import. It exposes the same two calls as
 * `analytics` and nothing provider-shaped.
 */
export const AnalyticsContext = createContext(analytics);

export function useAnalytics() {
  return useContext(AnalyticsContext);
}
