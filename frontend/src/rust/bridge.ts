import { getRustRuntimeAvailability, resolveRustAssetUrl, type RustRuntimeManifest } from "./runtime";

type RustBridgeModule = {
  createRuntimeBridge?: (options: { wasmUrl: string }) => Promise<RustRuntimeBridge> | RustRuntimeBridge;
};

export type RustRuntimeBridge = {
  initialize: () => Promise<void>;
  convert: (input: Uint8Array) => Promise<Uint8Array>;
};

export async function loadRustRuntimeBridge(): Promise<{
  manifest: RustRuntimeManifest;
  bridge: RustRuntimeBridge;
}> {
  const availability = await getRustRuntimeAvailability();
  if (!availability.available || !availability.manifest) {
    throw new Error(availability.reason ?? "RUST_RUNTIME_UNAVAILABLE: Rust runtime manifest is missing.");
  }

  if (!availability.manifest.entryJs) {
    throw new Error("RUST_BRIDGE_UNAVAILABLE: Rust runtime manifest does not declare entryJs.");
  }

  const entryJsUrl = resolveRustAssetUrl(availability.manifest.entryJs);
  const entryWasmUrl = availability.manifest.entryWasm
    ? resolveRustAssetUrl(availability.manifest.entryWasm)
    : "";

  const module = (await import(/* @vite-ignore */ entryJsUrl)) as RustBridgeModule;
  if (typeof module.createRuntimeBridge !== "function") {
    throw new Error(`RUST_BRIDGE_INVALID: createRuntimeBridge export was not found in ${entryJsUrl}`);
  }

  const bridge = await module.createRuntimeBridge({ wasmUrl: entryWasmUrl });
  return {
    manifest: availability.manifest,
    bridge,
  };
}