export const APP_VERSION = "1.5.3";

export const SENTRY_RELEASE =
  import.meta.env.VITE_SENTRY_RELEASE?.trim() || `vrm2pmx-web@${APP_VERSION}`;