import * as Sentry from "@sentry/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import ReactPWAInstallProvider from "react-pwa-install";
import App from "./App";
import "./app.css";
import { SENTRY_RELEASE } from "./constants/appInfo";

const PWAInstallProvider = ReactPWAInstallProvider as React.ComponentType<{
  children?: React.ReactNode;
  enableLogging?: boolean;
}>;

const ERROR_REPORTING_STORAGE_KEY = "vrm2pmx.errorReporting.enabled.v1";

Sentry.init({
  dsn: "https://6c85ff880cc188e3dc7f71851b4f317c@o4511099786231808.ingest.us.sentry.io/4511099792588800",
  environment: import.meta.env.MODE,
  release: SENTRY_RELEASE,
  sendDefaultPii: false,
  beforeSend(event) {
    try {
      const enabled = window.localStorage.getItem(ERROR_REPORTING_STORAGE_KEY) === "true";
      if (!enabled) {
        return null;
      }
    } catch {
      return null;
    }
    return event;
  },
});

registerSW({
  immediate: true,
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PWAInstallProvider>
      <App />
    </PWAInstallProvider>
  </React.StrictMode>,
);
