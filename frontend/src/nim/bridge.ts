import { APP_VERSION } from "../constants/appInfo";
import {
  getNimRuntimeAvailability,
  resolveNimAssetUrl,
  type NimRuntimeManifest,
} from "./runtime";

export type NimBridgeOptions = {
  wasmUrl: string;
  versionName?: string;
};

export type NimConvertRequest = {
  fileName: string;
  input: Uint8Array;
};

export type NimConvertResult = {
  output: Uint8Array;
  fileExtension: "pmx" | "zip";
};

type NimBridgeModule = {
  createRuntimeBridge?: (
    options: NimBridgeOptions,
  ) => Promise<NimRuntimeBridge> | NimRuntimeBridge;
};

export type NimRuntimeBridge = {
  initialize: () => Promise<void>;
  convert: (request: NimConvertRequest) => Promise<NimConvertResult>;
};

export async function loadNimRuntimeBridge(): Promise<{
  manifest: NimRuntimeManifest;
  bridge: NimRuntimeBridge;
}> {
  const availability = await getNimRuntimeAvailability();
  if (!availability.available || !availability.manifest) {
    throw new Error(
      availability.reason ??
        "NIM_RUNTIME_UNAVAILABLE: Nim runtime manifest is missing.",
    );
  }

  if (!availability.manifest.entryJs) {
    throw new Error(
      "NIM_BRIDGE_UNAVAILABLE: Nim runtime manifest does not declare entryJs.",
    );
  }

  const entryJsUrl = resolveNimAssetUrl(availability.manifest.entryJs);
  const entryWasmUrl = availability.manifest.entryWasm
    ? resolveNimAssetUrl(availability.manifest.entryWasm)
    : "";

  const module = (await import(
    /* @vite-ignore */ entryJsUrl
  )) as NimBridgeModule;
  if (typeof module.createRuntimeBridge !== "function") {
    throw new Error(
      `NIM_BRIDGE_INVALID: createRuntimeBridge export was not found in ${entryJsUrl}`,
    );
  }

  const bridge = await module.createRuntimeBridge({ wasmUrl: entryWasmUrl });
  return {
    manifest: availability.manifest,
    bridge,
  };
}
