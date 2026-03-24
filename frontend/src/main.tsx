import * as Sentry from "@sentry/react";
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

Sentry.init({
  dsn: "https://6c85ff880cc188e3dc7f71851b4f317c@o4511099786231808.ingest.us.sentry.io/4511099792588800",
  environment: import.meta.env.MODE,
  sendDefaultPii: false,
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
