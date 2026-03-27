export async function createRuntimeBridge(options = {}) {
  const wasmUrl = options.wasmUrl || "";

  return {
    async initialize() {
      if (!wasmUrl) {
        throw new Error("RUST_WASM_UNAVAILABLE: Rust loader bridge is present, but entryWasm is empty.");
      }

      throw new Error(`RUST_WASM_NOT_IMPLEMENTED: Rust loader bridge received wasmUrl=${wasmUrl}, but real initialization is not implemented yet.`);
    },
    async convert() {
      throw new Error("RUST_CONVERT_NOT_IMPLEMENTED: Placeholder Rust loader bridge cannot convert yet.");
    },
  };
}