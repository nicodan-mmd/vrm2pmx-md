import packageJson from "../../package.json";

export const APP_VERSION = packageJson.version;

export const SENTRY_RELEASE =
  import.meta.env.VITE_SENTRY_RELEASE?.trim() || `vrm2pmx-web@${APP_VERSION}`;
