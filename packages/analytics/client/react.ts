/**
 * The optional React binding: a component that starts the installed runtime after hydration
 * and keeps it told of consent, and a hook for components that prefer one to an import.
 * Kept apart from `./index` so that entry stays free of React.
 */
export { AnalyticsProvider } from "./AnalyticsProvider.js";
export { AnalyticsContext, useAnalytics } from "./AnalyticsContext.js";
