import { useState, useEffect } from "react";

const ERROR_REPORTING_STORAGE_KEY = "vrm2pmx.errorReporting.enabled.v1";

export function useErrorReportingConsent() {
  const [isErrorReportingEnabled, setIsErrorReportingEnabled] = useState(false);
  const [isErrorReportingPromptOpen, setIsErrorReportingPromptOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ERROR_REPORTING_STORAGE_KEY);
      if (raw === null) {
        setIsErrorReportingPromptOpen(true);
        return;
      }
      setIsErrorReportingEnabled(raw === "true");
    } catch (error) {
      console.warn("Failed to restore error reporting consent from localStorage", error);
    }
  }, []);

  function persistErrorReportingConsent(enabled: boolean) {
    setIsErrorReportingEnabled(enabled);
    try {
      window.localStorage.setItem(ERROR_REPORTING_STORAGE_KEY, String(enabled));
    } catch (error) {
      console.warn("Failed to persist error reporting consent to localStorage", error);
    }
  }

  function resetConsent() {
    window.localStorage.removeItem(ERROR_REPORTING_STORAGE_KEY);
    setIsErrorReportingEnabled(false);
    setIsErrorReportingPromptOpen(true);
  }

  return {
    isErrorReportingEnabled,
    isErrorReportingPromptOpen,
    setIsErrorReportingPromptOpen,
    persistErrorReportingConsent,
    resetConsent,
  };
}
