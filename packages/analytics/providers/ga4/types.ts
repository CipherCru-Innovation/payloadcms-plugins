export type Ga4DeliveryMode = "direct" | "via_gtm";

export type Ga4Options = {
  deliveryMode: Ga4DeliveryMode;
  /** Present in direct mode, where the adapter loads gtag.js itself. */
  measurementId?: string;
  sendPageViews: boolean;
};

export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]+$/;
/** GA4's own limits: 40 characters, letters, digits and underscores, starting with a letter. */
export const GA4_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const GA4_RESERVED_PREFIXES = ["google_", "ga_", "firebase_"] as const;
