/** The public options the GTM definition projects and the adapter reads. */
export type GtmOptions = {
  containerId: string;
  dataLayerName: string;
  /** A GTM environment's `gtm_auth` and `gtm_preview`; never sent on production. */
  auth?: string;
  preview?: string;
  /** Strip ad-click identifiers while ad storage is denied. */
  adsDataRedaction: boolean;
};

export const GTM_CONTAINER_ID = /^GTM-[A-Z0-9]+$/;
export const DATA_LAYER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
