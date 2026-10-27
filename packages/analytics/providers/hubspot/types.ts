export type HubSpotOptions = {
  portalId: string;
  /** Mapped events as custom behavioural events; HubSpot accepts them only on some plans. */
  eventForwarding: boolean;
  disableCookieBanner: boolean;
};

export const HUBSPOT_PORTAL_ID = /^\d+$/;
