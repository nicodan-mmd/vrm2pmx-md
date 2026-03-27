import { useState, useEffect, useRef } from "react";
import type { ConvertMode } from "../../../services/convertClient";

const UI_SETTINGS_STORAGE_KEY = "vrm2pmx.ui.settings.v1";

export const PMX_LIGHT_DEFAULT_INTENSITY_SCALE = 1.2;
export const PMX_LIGHT_DEFAULT_CONTRAST_FACTOR = 1.1;

type UiSettingsSnapshot = {
  mode: ConvertMode;
  taPoseAngle: number;
  orbitSyncEnabled: boolean;
  logEnabled: boolean;
  rustEnabled: boolean;
  pmxBrightnessScale: number;
  pmxContrastFactor: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useUiSettings() {
  const [mode, setMode] = useState<ConvertMode>("wasm");
  const [taPoseAngle, setTaPoseAngle] = useState(0);
  const [orbitSyncEnabled, setOrbitSyncEnabled] = useState(true);
  const orbitSyncEnabledRef = useRef(true);
  const [logEnabled, setLogEnabled] = useState(false);
  const logEnabledRef = useRef(false);
  const [rustEnabled, setRustEnabled] = useState(false);
  const [gridEnabled, setGridEnabled] = useState(false);
  const gridEnabledRef = useRef(false);
  const [pmxBrightnessScale, setPmxBrightnessScale] = useState(PMX_LIGHT_DEFAULT_INTENSITY_SCALE);
  const [pmxContrastFactor, setPmxContrastFactor] = useState(PMX_LIGHT_DEFAULT_CONTRAST_FACTOR);
  const [isUiSettingsHydrated, setIsUiSettingsHydrated] = useState(false);
  const skipNextSettingsPersistRef = useRef(false);

  useEffect(() => {
    orbitSyncEnabledRef.current = orbitSyncEnabled;
  }, [orbitSyncEnabled]);

  useEffect(() => {
    logEnabledRef.current = logEnabled;
  }, [logEnabled]);

  useEffect(() => {
    gridEnabledRef.current = gridEnabled;
    // TODO: Grid visibility toggle (debug feature)
    // Grid helper creation and visibility control pending grid size refinement
    // if (vrmGridRef.current) {
    //   vrmGridRef.current.visible = gridEnabled;
    // }
    // if (pmxGridRef.current) {
    //   pmxGridRef.current.visible = gridEnabled;
    // }
  }, [gridEnabled]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<UiSettingsSnapshot>;
        if (saved.mode === "wasm" || saved.mode === "auto" || saved.mode === "backend") {
          setMode(saved.mode);
        }
        if (typeof saved.taPoseAngle === "number" && Number.isFinite(saved.taPoseAngle)) {
          const snapped = Math.round(clamp(saved.taPoseAngle, 0, 90) / 5) * 5;
          setTaPoseAngle(snapped);
        }
        if (typeof saved.orbitSyncEnabled === "boolean") {
          setOrbitSyncEnabled(saved.orbitSyncEnabled);
        }
        if (typeof saved.logEnabled === "boolean") {
          setLogEnabled(saved.logEnabled);
        }
        if (typeof saved.rustEnabled === "boolean") {
          setRustEnabled(saved.rustEnabled);
        }
        if (typeof saved.pmxBrightnessScale === "number" && Number.isFinite(saved.pmxBrightnessScale)) {
          setPmxBrightnessScale(clamp(saved.pmxBrightnessScale, 0.6, 1.2));
        }
        if (typeof saved.pmxContrastFactor === "number" && Number.isFinite(saved.pmxContrastFactor)) {
          setPmxContrastFactor(clamp(saved.pmxContrastFactor, 0.8, 1.4));
        }
      }
    } catch (error) {
      console.warn("Failed to restore UI settings from localStorage", error);
    } finally {
      setIsUiSettingsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isUiSettingsHydrated) {
      return;
    }

    if (skipNextSettingsPersistRef.current) {
      skipNextSettingsPersistRef.current = false;
      return;
    }

    const snapshot: UiSettingsSnapshot = {
      mode,
      taPoseAngle,
      orbitSyncEnabled,
      logEnabled,
      rustEnabled,
      pmxBrightnessScale,
      pmxContrastFactor,
    };

    try {
      window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn("Failed to persist UI settings to localStorage", error);
    }
  }, [
    isUiSettingsHydrated,
    mode,
    taPoseAngle,
    orbitSyncEnabled,
    logEnabled,
    rustEnabled,
    pmxBrightnessScale,
    pmxContrastFactor,
  ]);

  function resetToDefaults() {
    skipNextSettingsPersistRef.current = true;
    window.localStorage.removeItem(UI_SETTINGS_STORAGE_KEY);
    setMode("wasm");
    setTaPoseAngle(0);
    setOrbitSyncEnabled(true);
    setLogEnabled(false);
    setRustEnabled(false);
    setPmxBrightnessScale(PMX_LIGHT_DEFAULT_INTENSITY_SCALE);
    setPmxContrastFactor(PMX_LIGHT_DEFAULT_CONTRAST_FACTOR);
  }

  return {
    mode,
    setMode,
    taPoseAngle,
    setTaPoseAngle,
    orbitSyncEnabled,
    setOrbitSyncEnabled,
    orbitSyncEnabledRef,
    logEnabled,
    setLogEnabled,
    logEnabledRef,
    rustEnabled,
    setRustEnabled,
    gridEnabled,
    setGridEnabled,
    gridEnabledRef,
    pmxBrightnessScale,
    setPmxBrightnessScale,
    pmxContrastFactor,
    setPmxContrastFactor,
    isUiSettingsHydrated,
    resetToDefaults,
  };
}
