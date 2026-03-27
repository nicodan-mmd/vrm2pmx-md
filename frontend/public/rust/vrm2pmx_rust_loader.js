export async function createRuntimeBridge(options = {}) {
  const wasmUrl = options.wasmUrl || "";
  let runtimeExports = null;

  return {
    async initialize() {
      if (!wasmUrl) {
        throw new Error("RUST_WASM_UNAVAILABLE: Rust loader bridge is present, but entryWasm is empty.");
      }

      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`RUST_WASM_FETCH_FAILED: Rust wasm asset could not be fetched from ${wasmUrl} (status=${response.status}).`);
      }

      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      const exports = instance.exports || {};

      if (
        typeof exports.vrm2pmx_rust_stub_version !== "function" ||
        typeof exports.vrm2pmx_rust_convert_stub !== "function"
      ) {
        throw new Error(`RUST_WASM_INVALID: Rust wasm asset at ${wasmUrl} does not expose the expected stub exports.`);
      }

      runtimeExports = exports;
    },
    async convert(request = {}) {
      if (!runtimeExports) {
        throw new Error("RUST_RUNTIME_NOT_INITIALIZED: Rust bridge convert() was called before initialize().");
      }

      const fileName = request.fileName || "<unknown>";
      const status = runtimeExports.vrm2pmx_rust_convert_stub();
      const version = runtimeExports.vrm2pmx_rust_stub_version();
      throw new Error(`RUST_CONVERT_NOT_IMPLEMENTED: Rust wasm stub loaded successfully (version=${version}, status=${status}) but conversion is still stub-only for file=${fileName}.`);
    },
  };
}