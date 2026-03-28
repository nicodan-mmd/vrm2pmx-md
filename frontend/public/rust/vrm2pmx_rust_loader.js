const PARSE_ERROR_REASONS = {
  "-1": "input bytes too short for GLB header",
  "-2": "invalid GLB magic (not a VRM/GLB file)",
  "-3": "unsupported GLB version (expected 2)",
  "-4": "JSON chunk type not found at expected offset",
  "-5": "JSON chunk extends beyond the buffer",
};

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
        typeof exports.vrm2pmx_version !== "function" ||
        typeof exports.vrm2pmx_alloc !== "function" ||
        typeof exports.vrm2pmx_free !== "function" ||
        typeof exports.vrm2pmx_parse_glb_json_len !== "function" ||
        !(exports.memory instanceof WebAssembly.Memory)
      ) {
        throw new Error(`RUST_WASM_INVALID: Rust wasm asset at ${wasmUrl} does not expose the expected interface (version/alloc/free/parse_glb_json_len/memory).`);
      }

      runtimeExports = exports;
    },

    async convert(request = {}) {
      if (!runtimeExports) {
        throw new Error("RUST_RUNTIME_NOT_INITIALIZED: Rust bridge convert() was called before initialize().");
      }

      const fileName = request.fileName || "<unknown>";
      const input = request.input instanceof Uint8Array ? request.input : new Uint8Array(0);
      const version = runtimeExports.vrm2pmx_version();

      if (input.length === 0) {
        throw new Error(`RUST_CONVERT_INVALID_INPUT: Empty input for file=${fileName} (runtime v${version}).`);
      }

      // Allocate Rust/Wasm heap for the input bytes
      const ptr = runtimeExports.vrm2pmx_alloc(input.length);

      // Always re-read memory.buffer after alloc in case the heap grew
      new Uint8Array(runtimeExports.memory.buffer).set(input, ptr);

      const jsonLen = runtimeExports.vrm2pmx_parse_glb_json_len(ptr, input.length);
      runtimeExports.vrm2pmx_free(ptr, input.length);

      if (jsonLen < 0) {
        const reason = PARSE_ERROR_REASONS[String(jsonLen)] || `error code ${jsonLen}`;
        throw new Error(`RUST_CONVERT_INVALID_INPUT: GLB parse failed for file=${fileName}: ${reason}.`);
      }

      // GLB parsed successfully — conversion logic not yet implemented
      throw new Error(
        `RUST_CONVERT_NOT_IMPLEMENTED: Rust wasm parsed GLB header and JSON chunk successfully (jsonChunkSize=${jsonLen} bytes, runtime v${version}) but full PMX conversion is not yet implemented for file=${fileName}.`,
      );
    },
  };
}