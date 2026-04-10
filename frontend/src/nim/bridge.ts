import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { getNimRuntimeAvailability, resolveNimAssetUrl, type NimRuntimeManifest } from "./runtime";

const META_OUT_PTR_OFFSET = 0;
const META_OUT_LEN_OFFSET = 4;
const META_STATUS_OFFSET = 8;
const META_ERROR_CODE_OFFSET = 12;
const META_SIZE = 16;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

type WasiExports = {
  memory: WebAssembly.Memory;
  nim_wasm_init: () => number;
  nim_wasm_alloc: (size: number) => number;
  nim_wasm_free: (ptr: number) => void;
  nim_wasm_last_error_len: () => number;
  nim_wasm_copy_last_error: (ptr: number, len: number) => number;
  nim_wasm_convert: (inputPtr: number, inputLen: number, metaPtr: number) => number;
};

export type NimConvertRequest = {
  fileName: string;
  input: Uint8Array;
};

export type NimConvertResult = {
  output: Uint8Array;
  fileExtension: "zip";
};

export type NimRuntimeBridge = {
  initialize: () => Promise<void>;
  convert: (request: NimConvertRequest) => Promise<NimConvertResult>;
};

let nimBridgePromise: Promise<{ manifest: NimRuntimeManifest; bridge: NimRuntimeBridge }> | null = null;

function createWasiImports(runtimeRef: {
  memory: WebAssembly.Memory | null;
  lastMessage: string;
}): WebAssembly.Imports {
  const textDecoder = new TextDecoder();

  function readBytes(ptr: number, len: number): Uint8Array {
    const memory = runtimeRef.memory;
    if (!memory) {
      return new Uint8Array();
    }

    return new Uint8Array(memory.buffer, ptr, len);
  }

  return {
    env: {
      emscripten_notify_memory_growth() {
        // No-op: JS side reads memory via fresh views after wasm calls complete.
      },
    },
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        const detail = runtimeRef.lastMessage.trim();
        throw new Error(
          detail.length > 0
            ? `NIM_WASM_PROC_EXIT: ${code}: ${detail}`
            : `NIM_WASM_PROC_EXIT: ${code}`,
        );
      },
      fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) {
        const memory = runtimeRef.memory;
        if (!memory) {
          return 0;
        }

        const dataView = new DataView(memory.buffer);
        let totalWritten = 0;
        let output = "";

        for (let index = 0; index < iovsLen; index += 1) {
          const base = iovsPtr + index * 8;
          const ptr = dataView.getUint32(base, true);
          const len = dataView.getUint32(base + 4, true);
          const chunk = readBytes(ptr, len);
          totalWritten += len;
          output += textDecoder.decode(chunk);
        }

        if (nwrittenPtr) {
          dataView.setUint32(nwrittenPtr, totalWritten, true);
        }

        if (output.trim().length > 0) {
          runtimeRef.lastMessage = output.trimEnd();
          const method = fd === 2 ? console.warn : console.info;
          method(`[nim-wasm] ${runtimeRef.lastMessage}`);
        }

        return 0;
      },
      fd_read(_fd: number, _iovsPtr: number, _iovsLen: number, nreadPtr: number) {
        const memory = runtimeRef.memory;
        if (!memory) {
          return 0;
        }
        new DataView(memory.buffer).setUint32(nreadPtr, 0, true);
        return 0;
      },
      fd_close() {
        return 0;
      },
      environ_sizes_get(countPtr: number, sizePtr: number) {
        const memory = runtimeRef.memory;
        if (!memory) {
          return 0;
        }
        const view = new DataView(memory.buffer);
        view.setUint32(countPtr, 0, true);
        view.setUint32(sizePtr, 0, true);
        return 0;
      },
      environ_get() {
        return 0;
      },
      fd_seek(_fd: number, _offsetLow: number, _offsetHigh: number, _whence: number, newOffsetPtr: number) {
        const memory = runtimeRef.memory;
        if (!memory) {
          return 0;
        }
        const view = new DataView(memory.buffer);
        view.setBigUint64(newOffsetPtr, 0n, true);
        return 0;
      },
    },
  };
}

async function loadWasmExports(wasmUrl: string): Promise<WasiExports> {
  const runtimeRef = {
    memory: null as WebAssembly.Memory | null,
    lastMessage: "",
  };
  const imports = createWasiImports(runtimeRef);
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`NIM_WASM_UNAVAILABLE: Failed to fetch ${wasmUrl}`);
  }

  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const exports = instance.exports as unknown as Partial<WasiExports>;

  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error("NIM_WASM_INVALID: memory export was not found.");
  }

  runtimeRef.memory = exports.memory;

  const requiredNames = [
    "nim_wasm_init",
    "nim_wasm_alloc",
    "nim_wasm_free",
    "nim_wasm_last_error_len",
    "nim_wasm_copy_last_error",
    "nim_wasm_convert",
  ] as const;

  for (const name of requiredNames) {
    if (typeof exports[name] !== "function") {
      throw new Error(`NIM_WASM_INVALID: required export ${name} was not found.`);
    }
  }

  return exports as WasiExports;
}

function readError(exports: WasiExports): string {
  const errorLen = exports.nim_wasm_last_error_len();
  if (errorLen <= 0) {
    return "Unknown Nim Wasm error";
  }

  const errorPtr = exports.nim_wasm_alloc(errorLen);
  if (!errorPtr) {
    return "Unknown Nim Wasm error";
  }

  try {
    const copied = exports.nim_wasm_copy_last_error(errorPtr, errorLen);
    if (copied <= 0) {
      return "Unknown Nim Wasm error";
    }

    return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, errorPtr, copied));
  } finally {
    exports.nim_wasm_free(errorPtr);
  }
}

function safeRelPath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!normalized) {
    return null;
  }

  const parts = normalized
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== ".");

  if (parts.length === 0 || parts.some((part) => part === "..")) {
    return null;
  }

  return parts.join("/");
}

function buildWhiteBmpBytes(): Uint8Array {
  return new Uint8Array([
    0x42, 0x4d,
    0x3a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x36, 0x00, 0x00, 0x00,
    0x28, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x18, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x04, 0x00, 0x00, 0x00,
    0x13, 0x0b, 0x00, 0x00,
    0x13, 0x0b, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0xff, 0xff, 0xff, 0x00,
  ]);
}

function buildSolidBmpBytes(r: number, g: number, b: number): Uint8Array {
  const bytes = buildWhiteBmpBytes();
  const pixelOffset = bytes.length - 4;
  // 24-bit BMP pixel order is B, G, R (+1 byte row padding for 1x1).
  bytes[pixelOffset] = Math.max(0, Math.min(255, b | 0));
  bytes[pixelOffset + 1] = Math.max(0, Math.min(255, g | 0));
  bytes[pixelOffset + 2] = Math.max(0, Math.min(255, r | 0));
  bytes[pixelOffset + 3] = 0x00;
  return bytes;
}

function pickBmpPlaceholderColor(path: string): [number, number, number] {
  const lower = path.toLowerCase();

  // Prefer more specific names first.
  if (lower.includes("lightcyan") || lower.includes("\u8584\u6c34\u8272")) return [130, 205, 220];
  if (lower.includes("cyan") || lower.includes("aqua") || lower.includes("\u6c34\u8272")) return [70, 175, 205];
  if (lower.includes("lightyellow") || lower.includes("\u8584\u9ec4\u8272")) return [220, 200, 110];
  if (lower.includes("lightgreen") || lower.includes("mint") || lower.includes("\u8584\u7dd1")) return [110, 205, 120];
  if (lower.includes("orange") || lower.includes("\u30aa\u30ec\u30f3\u30b8")) return [220, 120, 20];
  if (lower.includes("yellow") || lower.includes("\u9ec4")) return [205, 185, 30];
  if (lower.includes("pink") || lower.includes("\u30d4\u30f3\u30af")) return [210, 90, 145];
  if (lower.includes("purple") || lower.includes("violet") || lower.includes("\u7d2b")) return [120, 75, 175];
  if (lower.includes("blue") || lower.includes("\u9752")) return [70, 115, 205];
  if (lower.includes("red") || lower.includes("\u8d64")) return [185, 70, 70];
  if (lower.includes("gray") || lower.includes("grey") || lower.includes("\u7070")) return [120, 120, 120];
  if (lower.includes("green") || lower.includes("\u7dd1")) return [30, 170, 50];
  if (lower.includes("white") || lower.includes("\u767d")) return [220, 220, 220];
  if (lower.includes("black") || lower.includes("\u9ed2")) return [20, 20, 20];

  // Neutral fallback: slightly bright gray works better than pure white for toon ramps.
  return [160, 160, 160];
}

function buildWhitePngBytes(): Uint8Array {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZgE8AAAAASUVORK5CYII=";
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function buildPlaceholderTextureBytes(path: string): Uint8Array {
  if (path.toLowerCase().endsWith(".bmp")) {
    const [r, g, b] = pickBmpPlaceholderColor(path);
    return buildSolidBmpBytes(r, g, b);
  }
  return buildWhitePngBytes();
}

function decodeDataUri(uri: string): { bytes: Uint8Array; mimeType?: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(uri);
  if (!match) {
    return null;
  }

  const mimeType = match[1] || undefined;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || "";

  try {
    if (isBase64) {
      const binary = atob(payload);
      return {
        bytes: Uint8Array.from(binary, (char) => char.charCodeAt(0)),
        mimeType,
      };
    }

    return {
      bytes: Uint8Array.from(decodeURIComponent(payload), (char) => char.charCodeAt(0)),
      mimeType,
    };
  } catch {
    return null;
  }
}

function extractGlbEmbeddedImages(glbBytes: Uint8Array): Array<{ bytes: Uint8Array; mimeType?: string }> {
  if (glbBytes.byteLength < 12) {
    return [];
  }

  const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
  if (String.fromCharCode(...glbBytes.slice(0, 4)) !== "glTF") {
    return [];
  }

  let jsonChunk: Uint8Array | null = null;
  let binChunk: Uint8Array | null = null;
  let offset = 12;

  while (offset + 8 <= glbBytes.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > glbBytes.byteLength) {
      break;
    }

    if (chunkType === GLB_JSON_CHUNK_TYPE && !jsonChunk) {
      jsonChunk = glbBytes.slice(chunkStart, chunkEnd);
    } else if (chunkType === GLB_BIN_CHUNK_TYPE && !binChunk) {
      binChunk = glbBytes.slice(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }

  if (!jsonChunk) {
    return [];
  }

  try {
    const jsonText = new TextDecoder("utf-8").decode(jsonChunk).replace(/\u0000+$/g, "").trim();
    const gltf = JSON.parse(jsonText) as {
      images?: Array<{ bufferView?: number; mimeType?: string; uri?: string }>;
      bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
    };
    const images = Array.isArray(gltf.images) ? gltf.images : [];
    const bufferViews = Array.isArray(gltf.bufferViews) ? gltf.bufferViews : [];

    return images.map((image) => {
      if (typeof image !== "object" || !image) {
        return { bytes: new Uint8Array() };
      }

      if (
        typeof image.bufferView === "number" &&
        image.bufferView >= 0 &&
        image.bufferView < bufferViews.length &&
        binChunk
      ) {
        const bufferView = bufferViews[image.bufferView];
        const start = bufferView.byteOffset ?? 0;
        const length = bufferView.byteLength ?? 0;
        const end = start + length;
        if (length > 0 && start >= 0 && end <= binChunk.length) {
          return {
            bytes: binChunk.slice(start, end),
            mimeType: typeof image.mimeType === "string" ? image.mimeType : undefined,
          };
        }
      }

      if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
        const decoded = decodeDataUri(image.uri);
        if (decoded) {
          return decoded;
        }
      }

      return { bytes: new Uint8Array() };
    });
  } catch {
    return [];
  }
}

function parsePmxTextureRefs(pmxBytes: Uint8Array): string[] {
  if (pmxBytes.byteLength < 32) {
    return [];
  }

  const view = new DataView(pmxBytes.buffer, pmxBytes.byteOffset, pmxBytes.byteLength);
  if (String.fromCharCode(...pmxBytes.slice(0, 4)) !== "PMX ") {
    return [];
  }

  let offset = 4;
  offset += 4;
  const headerSize = view.getUint8(offset);
  offset += 1;
  if (offset + headerSize > pmxBytes.byteLength || headerSize < 8) {
    return [];
  }

  const encodingFlag = view.getUint8(offset);
  const additionalUvCount = view.getUint8(offset + 1);
  const vertexIndexSize = view.getUint8(offset + 2);
  const boneIndexSize = view.getUint8(offset + 5);
  offset += headerSize;

  const textDecoder = new TextDecoder(encodingFlag === 0 ? "utf-16le" : "utf-8");
  const readText = (): string => {
    const byteLength = view.getInt32(offset, true);
    offset += 4;
    if (byteLength <= 0 || offset + byteLength > pmxBytes.byteLength) {
      return "";
    }
    const text = textDecoder.decode(pmxBytes.slice(offset, offset + byteLength));
    offset += byteLength;
    return text;
  };

  for (let index = 0; index < 4; index += 1) {
    readText();
  }

  const vertexCount = view.getInt32(offset, true);
  offset += 4;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    offset += 12 + 12 + 8 + additionalUvCount * 16;
    const deformType = view.getUint8(offset);
    offset += 1;
    switch (deformType) {
      case 0:
        offset += boneIndexSize;
        break;
      case 1:
        offset += boneIndexSize * 2 + 4;
        break;
      case 2:
      case 4:
        offset += boneIndexSize * 4 + 16;
        break;
      case 3:
        offset += boneIndexSize * 2 + 4 + 36;
        break;
      default:
        return [];
    }
    offset += 4;
    if (offset > pmxBytes.byteLength) {
      return [];
    }
  }

  const faceIndexCount = view.getInt32(offset, true);
  offset += 4 + faceIndexCount * vertexIndexSize;
  if (offset + 4 > pmxBytes.byteLength) {
    return [];
  }

  const textureCount = view.getInt32(offset, true);
  offset += 4;
  const textureRefs: string[] = [];
  for (let textureIndex = 0; textureIndex < textureCount; textureIndex += 1) {
    textureRefs.push(readText());
  }
  return textureRefs;
}

async function wrapPmxBytesAsZip(fileName: string, inputBytes: Uint8Array, pmxBytes: Uint8Array): Promise<Uint8Array> {
  const blobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(blobWriter);
  const pmxName = `${fileName.replace(/\.[^.]+$/, "") || "model"}.pmx`;
  await zipWriter.add(pmxName, new Uint8ArrayReader(pmxBytes));

  const textureRefs = parsePmxTextureRefs(pmxBytes);
  const extractedImages = extractGlbEmbeddedImages(inputBytes);
  const addedPaths = new Set<string>([pmxName.toLowerCase()]);

  const sequentialTargets = textureRefs
    .map((textureRef) => safeRelPath(textureRef))
    .filter((path): path is string => Boolean(path))
    .filter((path) => !/\.(bmp|spa|sph|dds|tga)$/i.test(path));

  let imageIndex = 0;
  for (const targetPath of sequentialTargets) {
    while (imageIndex < extractedImages.length && extractedImages[imageIndex].bytes.length === 0) {
      imageIndex += 1;
    }
    if (imageIndex >= extractedImages.length) {
      break;
    }

    const image = extractedImages[imageIndex];
    imageIndex += 1;
    if (addedPaths.has(targetPath.toLowerCase())) {
      continue;
    }

    await zipWriter.add(targetPath, new Uint8ArrayReader(image.bytes));
    addedPaths.add(targetPath.toLowerCase());
  }

  for (const textureRef of textureRefs) {
    const targetPath = safeRelPath(textureRef);
    if (!targetPath || addedPaths.has(targetPath.toLowerCase())) {
      continue;
    }

    await zipWriter.add(targetPath, new Uint8ArrayReader(buildPlaceholderTextureBytes(targetPath)));
    addedPaths.add(targetPath.toLowerCase());
  }

  await zipWriter.add(
    "README_nim_wasm.txt",
    new TextReader(
      "Nim Wasm output now includes PMX plus provisional texture assets extracted from the source VRM. Some custom toon/sphere textures may still be neutral placeholders.\n",
    ),
  );
  await zipWriter.close();
  return new Uint8Array(await (await blobWriter.getData()).arrayBuffer());
}

function createNimRuntimeBridge(exports: WasiExports): NimRuntimeBridge {
  let initialized = false;

  return {
    async initialize() {
      if (initialized) {
        return;
      }

      const status = exports.nim_wasm_init();
      if (status !== 0) {
        throw new Error(`NIM_WASM_INIT_FAILED: ${readError(exports)}`);
      }

      initialized = true;
    },

    async convert(request) {
      const inputPtr = exports.nim_wasm_alloc(request.input.byteLength);
      const metaPtr = exports.nim_wasm_alloc(META_SIZE);
      if (!inputPtr || !metaPtr) {
        if (inputPtr) {
          exports.nim_wasm_free(inputPtr);
        }
        if (metaPtr) {
          exports.nim_wasm_free(metaPtr);
        }
        throw new Error("NIM_WASM_ALLOC_FAILED: input/meta allocation failed.");
      }

      let outputPtr = 0;
      try {
        new Uint8Array(exports.memory.buffer, inputPtr, request.input.byteLength).set(request.input);
        new Uint8Array(exports.memory.buffer, metaPtr, META_SIZE).fill(0);

        const returnCode = exports.nim_wasm_convert(inputPtr, request.input.byteLength, metaPtr);
        const metaView = new DataView(exports.memory.buffer, metaPtr, META_SIZE);
        outputPtr = metaView.getUint32(META_OUT_PTR_OFFSET, true);
        const outputLen = metaView.getInt32(META_OUT_LEN_OFFSET, true);
        const status = metaView.getInt32(META_STATUS_OFFSET, true);
        const errorCode = metaView.getInt32(META_ERROR_CODE_OFFSET, true);

        if (returnCode !== 0 || status !== 0 || outputPtr === 0 || outputLen <= 0) {
          const detail = readError(exports);
          throw new Error(`NIM_WASM_CONVERT_FAILED(${errorCode}): ${detail}`);
        }

        const pmxBytes = new Uint8Array(exports.memory.buffer, outputPtr, outputLen).slice();
        const zipBytes = await wrapPmxBytesAsZip(request.fileName, request.input, pmxBytes);
        return {
          output: zipBytes,
          fileExtension: "zip",
        } satisfies NimConvertResult;
      } finally {
        if (outputPtr) {
          exports.nim_wasm_free(outputPtr);
        }
        exports.nim_wasm_free(inputPtr);
        exports.nim_wasm_free(metaPtr);
      }
    },
  };
}

export async function loadNimRuntimeBridge(): Promise<{
  manifest: NimRuntimeManifest;
  bridge: NimRuntimeBridge;
}> {
  if (nimBridgePromise) {
    return nimBridgePromise;
  }

  nimBridgePromise = (async () => {
    const availability = await getNimRuntimeAvailability();
    if (!availability.available || !availability.manifest) {
      throw new Error(availability.reason ?? "NIM_RUNTIME_UNAVAILABLE: runtime manifest missing.");
    }

    const wasmUrl = resolveNimAssetUrl(`nim/${availability.manifest.entryWasm}`);
    const exports = await loadWasmExports(wasmUrl);
    const bridge = createNimRuntimeBridge(exports);

    return {
      manifest: availability.manifest,
      bridge,
    };
  })();

  return nimBridgePromise;
}