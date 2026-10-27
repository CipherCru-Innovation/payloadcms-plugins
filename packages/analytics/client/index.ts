/**
 * The browser side of the plugin. No Payload import: safe for client components and
 * `instrumentation-client`.
 */
export { createAnalyticsRuntime, installAnalytics, installedAnalytics, uninstallAnalytics } from "./runtime.js";
export type { AnalyticsRuntime, RuntimeOptions } from "./runtime.js";
export { analytics, track } from "./track.js";
export { pageView, forgetLastPageView } from "./pageView.js";
export { readConfig, CONFIG_ELEMENT_ID } from "./config.js";
export type { DispatchReport } from "../core/dispatcher.js";
export type { AnalyticsProvider as AnalyticsAdapter, AnalyticsContext, DispatchEvent } from "../providers/types.js";
export type { ConsentState, EventPayload, PublicAnalyticsConfig, ParameterValue } from "../core/types.js";
