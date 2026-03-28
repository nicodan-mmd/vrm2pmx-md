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
        typeof exports.vrm2pmx_get_json_chunk !== "function" ||
        !(exports.memory instanceof WebAssembly.Memory)
      ) {
        throw new Error(
          `RUST_WASM_INVALID: Rust wasm asset at ${wasmUrl} does not expose the expected interface (version/alloc/free/get_json_chunk/memory).`,
        );
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

      // 1. Copy input to Wasm heap.
      //    Re-read memory.buffer after every alloc — heap growth invalidates the ArrayBuffer ref.
      const inPtr = runtimeExports.vrm2pmx_alloc(input.length);
      new Uint8Array(runtimeExports.memory.buffer).set(input, inPtr);

      // 2. Allocate a 4-byte cell for vrm2pmx_get_json_chunk to write the output length into.
      const outLenPtr = runtimeExports.vrm2pmx_alloc(4);
      // Zero the cell before use (DataView, little-endian, handles unaligned access safely).
      new DataView(runtimeExports.memory.buffer).setInt32(outLenPtr, 0, true);

      // 3. Call into Rust to extract the JSON chunk bytes.
      const jsonPtr = runtimeExports.vrm2pmx_get_json_chunk(inPtr, input.length, outLenPtr);
      runtimeExports.vrm2pmx_free(inPtr, input.length);

      // Re-read outLen — memory.buffer may have changed during get_json_chunk if heap grew.
      const outLen = new DataView(runtimeExports.memory.buffer).getInt32(outLenPtr, true);
      runtimeExports.vrm2pmx_free(outLenPtr, 4);

      if (!jsonPtr || outLen < 0) {
        const reason = PARSE_ERROR_REASONS[String(outLen)] || `error code ${outLen}`;
        throw new Error(`RUST_CONVERT_INVALID_INPUT: GLB parse failed for file=${fileName}: ${reason}.`);
      }

      // 4. Copy JSON bytes into JS land, then free the Wasm-side buffer.
      //    Use .slice() so the Uint8Array owns its storage independently of Wasm memory.
      const jsonBytes = new Uint8Array(runtimeExports.memory.buffer, jsonPtr, outLen).slice();
      runtimeExports.vrm2pmx_free(jsonPtr, outLen);

      // 5. Decode and detect VRM version from the glTF extension keys.
      let vrmVersion = -1;
      try {
        const gltfJson = JSON.parse(new TextDecoder().decode(jsonBytes));
        const ext = (gltfJson && typeof gltfJson === "object" && gltfJson.extensions) || {};
        vrmVersion = ext.VRMC_vrm != null ? 1 : ext.VRM != null ? 0 : -1;
      } catch (_) {
        // JSON parse failure — vrmVersion stays -1
      }

      // Conversion logic not yet implemented; surface what we know so far.
      throw new Error(
        `RUST_CONVERT_NOT_IMPLEMENTED: Rust wasm extracted JSON chunk and detected VRM version ` +
          `(vrmVersion=${vrmVersion}, jsonChunkSize=${outLen} bytes, runtime v${version}) ` +
          `but PMX conversion is not yet implemented for file=${fileName}.`,
      );
    },
  };
}