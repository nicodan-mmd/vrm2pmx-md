function createWasiImports() {
  const decoder = new TextDecoder();
  let memory = null;

  function setMemory(nextMemory) {
    memory = nextMemory;
  }

  function getDataView() {
    if (!memory) {
      return null;
    }
    return new DataView(memory.buffer);
  }

  function readIoVectors(iovs, iovsLen) {
    const view = getDataView();
    if (!view || !memory) {
      return [];
    }

    const chunks = [];
    for (let index = 0; index < iovsLen; index += 1) {
      const base = iovs + index * 8;
      const ptr = view.getUint32(base, true);
      const len = view.getUint32(base + 4, true);
      chunks.push(new Uint8Array(memory.buffer, ptr, len));
    }
    return chunks;
  }

  function concatChunks(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  return {
    imports: {
      env: {
        emscripten_notify_memory_growth() {},
      },
      wasi_snapshot_preview1: {
        proc_exit(code) {
          throw new Error(`NIM_WASM_PROC_EXIT: proc_exit(${code}) was called.`);
        },
        fd_write(fd, iovs, iovsLen, nwritten) {
          const chunks = readIoVectors(iovs, iovsLen);
          const merged = concatChunks(chunks);
          const message = decoder.decode(merged);
          const view = getDataView();
          if (view && nwritten) {
            view.setUint32(nwritten, merged.byteLength, true);
          }
          if (message.trim()) {
            if (fd === 2) {
              console.warn(message.trim());
            } else {
              console.info(message.trim());
            }
          }
          return 0;
        },
        fd_read(_fd, _iovs, _iovsLen, nread) {
          const view = getDataView();
          if (view && nread) {
            view.setUint32(nread, 0, true);
          }
          return 0;
        },
        fd_close() {
          return 0;
        },
        environ_sizes_get(countPtr, bufferSizePtr) {
          const view = getDataView();
          if (view) {
            view.setUint32(countPtr, 0, true);
            view.setUint32(bufferSizePtr, 0, true);
          }
          return 0;
        },
        environ_get() {
          return 0;
        },
        fd_seek(_fd, _offset, _whence, newOffsetPtr) {
          const view = getDataView();
          if (view) {
            view.setBigUint64(newOffsetPtr, 0n, true);
          }
          return 0;
        },
      },
    },
    setMemory,
  };
}

function decodeUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

export async function createRuntimeBridge(options = {}) {
  const wasmUrl = options.wasmUrl || "";
  let runtimeExports = null;
  const wasi = createWasiImports();

  function getMemory() {
    if (!(runtimeExports && runtimeExports.memory instanceof WebAssembly.Memory)) {
      throw new Error("NIM_RUNTIME_NOT_INITIALIZED: memory export is not available.");
    }
    return runtimeExports.memory;
  }

  function readLastError() {
    if (!runtimeExports) {
      return "Unknown Nim runtime error";
    }

    const length = Number(runtimeExports.nim_wasm_last_error_len());
    if (!Number.isFinite(length) || length <= 0) {
      return "Unknown Nim runtime error";
    }

    const errorPtr = Number(runtimeExports.nim_wasm_alloc(length));
    if (!errorPtr) {
      return "Unknown Nim runtime error";
    }

    try {
      const copied = Number(runtimeExports.nim_wasm_copy_last_error(errorPtr, length));
      const actualLength = copied > 0 ? copied : length;
      const bytes = new Uint8Array(getMemory().buffer, errorPtr, actualLength).slice();
      return decodeUtf8(bytes).replace(/\0+$/, "").trim() || "Unknown Nim runtime error";
    } finally {
      runtimeExports.nim_wasm_free(errorPtr);
    }
  }

  return {
    async initialize() {
      if (!wasmUrl) {
        throw new Error("NIM_WASM_UNAVAILABLE: Nim runtime manifest does not declare entryWasm.");
      }

      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(`NIM_WASM_FETCH_FAILED: Nim wasm asset could not be fetched from ${wasmUrl} (status=${response.status}).`);
      }

      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, wasi.imports);
      const exports = instance.exports || {};

      if (
        typeof exports.nim_wasm_init !== "function" ||
        typeof exports.nim_wasm_alloc !== "function" ||
        typeof exports.nim_wasm_free !== "function" ||
        typeof exports.nim_wasm_last_error_len !== "function" ||
        typeof exports.nim_wasm_copy_last_error !== "function" ||
        typeof exports.nim_wasm_convert !== "function" ||
        !(exports.memory instanceof WebAssembly.Memory)
      ) {
        throw new Error(
          `NIM_WASM_INVALID: Nim wasm asset at ${wasmUrl} does not expose the expected interface (init/alloc/free/last_error/convert/memory).`,
        );
      }

      runtimeExports = exports;
      wasi.setMemory(exports.memory);

      const status = Number(exports.nim_wasm_init());
      if (status !== 0) {
        throw new Error(`NIM_WASM_INIT_FAILED: ${readLastError()}`);
      }
    },

    async convert(request = {}) {
      if (!runtimeExports) {
        throw new Error("NIM_RUNTIME_NOT_INITIALIZED: Nim bridge convert() was called before initialize().");
      }

      const fileName = request.fileName || "<unknown>";
      const input = request.input instanceof Uint8Array ? request.input : new Uint8Array(0);
      if (input.length === 0) {
        throw new Error(`NIM_CONVERT_INVALID_INPUT: Empty input for file=${fileName}.`);
      }

      const metaSize = 16;
      const inPtr = Number(runtimeExports.nim_wasm_alloc(input.length));
      const metaPtr = Number(runtimeExports.nim_wasm_alloc(metaSize));

      if (!inPtr || !metaPtr) {
        if (inPtr) {
          runtimeExports.nim_wasm_free(inPtr);
        }
        if (metaPtr) {
          runtimeExports.nim_wasm_free(metaPtr);
        }
        throw new Error("NIM_WASM_ALLOC_FAILED: Could not allocate input/meta buffers in Nim Wasm heap.");
      }

      let outPtr = 0;
      try {
        new Uint8Array(getMemory().buffer).set(input, inPtr);
        const metaView = new DataView(getMemory().buffer, metaPtr, metaSize);
        metaView.setUint32(0, 0, true);
        metaView.setInt32(4, 0, true);
        metaView.setInt32(8, 0, true);
        metaView.setInt32(12, 0, true);

        const resultCode = Number(runtimeExports.nim_wasm_convert(inPtr, input.length, metaPtr));
        const resultView = new DataView(getMemory().buffer, metaPtr, metaSize);
        outPtr = resultView.getUint32(0, true);
        const outLen = resultView.getInt32(4, true);
        const status = resultView.getInt32(8, true);
        const errorCode = resultView.getInt32(12, true);

        if (resultCode !== 0 || status !== 0) {
          const reason = readLastError();
          throw new Error(`NIM_CONVERT_FAILED: file=${fileName}, errorCode=${errorCode}, message=${reason}`);
        }

        if (!outPtr || outLen <= 0) {
          throw new Error(`NIM_CONVERT_EMPTY_OUTPUT: file=${fileName}, outPtr=${outPtr}, outLen=${outLen}`);
        }

        const output = new Uint8Array(getMemory().buffer, outPtr, outLen).slice();
        return {
          output,
          fileExtension: "pmx",
        };
      } finally {
        runtimeExports.nim_wasm_free(inPtr);
        runtimeExports.nim_wasm_free(metaPtr);
        if (outPtr) {
          runtimeExports.nim_wasm_free(outPtr);
        }
      }
    },
  };
}