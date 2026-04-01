import { buildPmxFromGltf } from "./pmxWriter.js";

const PARSE_ERROR_REASONS = {
  "-1": "input bytes too short for GLB header",
  "-2": "invalid GLB magic (not a VRM/GLB file)",
  "-3": "unsupported GLB version (expected 2)",
  "-4": "JSON chunk type not found at expected offset",
  "-5": "JSON chunk extends beyond the buffer",
};
const PARSE_ERROR_REASONS_BIN = {
  "-6": "no BIN chunk present in GLB",
  "-7": "BIN chunk extends beyond the buffer",
};

// ---------------------------------------------------------------------------
// glTF accessor helpers (pure JS, operate on the bin ArrayBuffer)
// ---------------------------------------------------------------------------

const GLTF_COMPONENT = {
  5120: { bytes: 1, read: (dv, o) => dv.getInt8(o) },
  5121: { bytes: 1, read: (dv, o) => dv.getUint8(o) },
  5122: { bytes: 2, read: (dv, o) => dv.getInt16(o, true) },
  5123: { bytes: 2, read: (dv, o) => dv.getUint16(o, true) },
  5125: { bytes: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { bytes: 4, read: (dv, o) => dv.getFloat32(o, true) },
};
const GLTF_TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/**
 * Read all elements from a glTF accessor into a flat array.
 * Returns null if the accessor / bufferView / bufferView data is absent.
 */
function readAccessor(gltfJson, binBuffer, accessorIndex) {
  const accessor = gltfJson.accessors && gltfJson.accessors[accessorIndex];
  if (!accessor) return null;
  const bv = gltfJson.bufferViews && gltfJson.bufferViews[accessor.bufferViewIndex ?? accessor.bufferView];
  if (!bv) return null;
  const comp = GLTF_COMPONENT[accessor.componentType];
  if (!comp) return null;
  const numComponents = GLTF_TYPE_COUNT[accessor.type];
  if (!numComponents) return null;

  const byteOffset = (bv.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = bv.byteStride || comp.bytes * numComponents;
  const dv = new DataView(binBuffer);
  const result = [];

  for (let i = 0; i < accessor.count; i++) {
    const base = byteOffset + i * byteStride;
    for (let c = 0; c < numComponents; c++) {
      result.push(comp.read(dv, base + c * comp.bytes));
    }
  }
  return result;
}

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
        typeof exports.vrm2pmx_get_bin_chunk !== "function" ||
        !(exports.memory instanceof WebAssembly.Memory)
      ) {
        throw new Error(
          `RUST_WASM_INVALID: Rust wasm asset at ${wasmUrl} does not expose the expected interface (version/alloc/free/get_json_chunk/get_bin_chunk/memory).`,
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

      // 6. Extract the BIN chunk via Rust.
      let gltfJson = null;
      try {
        gltfJson = JSON.parse(new TextDecoder().decode(jsonBytes));
      } catch (_) {
        throw new Error(`RUST_CONVERT_INVALID_INPUT: GLB JSON chunk is not valid JSON for file=${fileName}.`);
      }

      const binOutLenPtr = runtimeExports.vrm2pmx_alloc(4);
      new DataView(runtimeExports.memory.buffer).setInt32(binOutLenPtr, 0, true);

      const inPtr2 = runtimeExports.vrm2pmx_alloc(input.length);
      new Uint8Array(runtimeExports.memory.buffer).set(input, inPtr2);

      const binPtr = runtimeExports.vrm2pmx_get_bin_chunk(inPtr2, input.length, binOutLenPtr);
      runtimeExports.vrm2pmx_free(inPtr2, input.length);

      const binLen = new DataView(runtimeExports.memory.buffer).getInt32(binOutLenPtr, true);
      runtimeExports.vrm2pmx_free(binOutLenPtr, 4);

      let binBuffer = null;
      if (binPtr && binLen > 0) {
        binBuffer = new Uint8Array(runtimeExports.memory.buffer, binPtr, binLen).slice().buffer;
        runtimeExports.vrm2pmx_free(binPtr, binLen);
      }

      // 7. Build PMX 2.0 binary from the parsed glTF data.
      const pmxBytes = buildPmxFromGltf(gltfJson, binBuffer, { modelName: fileName });
      return { output: pmxBytes, fileExtension: "pmx", usedMode: "rust" };
    },
  };
}