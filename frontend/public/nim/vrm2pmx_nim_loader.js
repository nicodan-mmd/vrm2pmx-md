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

function encodeUtf16Le(text) {
  const buffer = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    buffer[index * 2] = codeUnit & 0xff;
    buffer[index * 2 + 1] = codeUnit >> 8;
  }
  return buffer;
}

function normalizePmxHeaderComments(pmxBytes, versionName) {
  if (
    !(pmxBytes instanceof Uint8Array) ||
    pmxBytes.length < 24 ||
    !versionName
  ) {
    return pmxBytes;
  }

  const view = new DataView(
    pmxBytes.buffer,
    pmxBytes.byteOffset,
    pmxBytes.byteLength,
  );
  if (
    pmxBytes[0] !== 0x50 || // P
    pmxBytes[1] !== 0x4d || // M
    pmxBytes[2] !== 0x58 || // X
    pmxBytes[3] !== 0x20 // ' '
  ) {
    return pmxBytes;
  }

  let offset = 8;
  if (offset >= pmxBytes.length) {
    return pmxBytes;
  }

  const globalsLen = pmxBytes[offset];
  if (offset + 1 + globalsLen > pmxBytes.length) {
    return pmxBytes;
  }
  offset += 1 + globalsLen;

  const textRanges = [];
  for (let index = 0; index < 4; index += 1) {
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const textLen = view.getInt32(offset, true);
    const textStart = offset + 4;
    const textEnd = textStart + textLen;
    if (textLen < 0 || textEnd > pmxBytes.length) {
      return pmxBytes;
    }
    textRanges.push({ lengthOffset: offset, textStart, textEnd, textLen });
    offset = textEnd;
  }

  const commentRange = textRanges[2];
  if (!commentRange) {
    return pmxBytes;
  }

  const commentText = new TextDecoder("utf-16le").decode(
    pmxBytes.subarray(commentRange.textStart, commentRange.textEnd),
  );
  const nextCommentText = commentText.replace(
    /変換: VRM to MMD Converter - Version .*?  \(@nicodan-mmd\)/,
    `変換: VRM to MMD Converter - Version ${versionName}  (@nicodan-mmd)`,
  );

  if (nextCommentText === commentText) {
    return pmxBytes;
  }

  const nextCommentBytes = encodeUtf16Le(nextCommentText);
  const sizeDelta = nextCommentBytes.length - commentRange.textLen;

  if (sizeDelta === 0) {
    view.setInt32(commentRange.lengthOffset, nextCommentBytes.length, true);
    pmxBytes.set(nextCommentBytes, commentRange.textStart);
    return pmxBytes;
  }

  const nextBytes = new Uint8Array(pmxBytes.length + sizeDelta);
  nextBytes.set(pmxBytes.subarray(0, commentRange.lengthOffset), 0);
  const nextView = new DataView(nextBytes.buffer);
  nextView.setInt32(commentRange.lengthOffset, nextCommentBytes.length, true);
  nextBytes.set(nextCommentBytes, commentRange.lengthOffset + 4);
  nextBytes.set(
    pmxBytes.subarray(commentRange.textEnd),
    commentRange.lengthOffset + 4 + nextCommentBytes.length,
  );
  return nextBytes;
}

function normalizePmxTextureSeparators(pmxBytes) {
  if (!(pmxBytes instanceof Uint8Array) || pmxBytes.length < 24) {
    return pmxBytes;
  }

  const view = new DataView(
    pmxBytes.buffer,
    pmxBytes.byteOffset,
    pmxBytes.byteLength,
  );
  if (
    pmxBytes[0] !== 0x50 || // P
    pmxBytes[1] !== 0x4d || // M
    pmxBytes[2] !== 0x58 || // X
    pmxBytes[3] !== 0x20 // ' '
  ) {
    return pmxBytes;
  }

  let offset = 8;
  if (offset >= pmxBytes.length) {
    return pmxBytes;
  }

  const globalsLen = pmxBytes[offset];
  if (offset + 1 + globalsLen > pmxBytes.length) {
    return pmxBytes;
  }
  const globalsStart = offset + 1;
  const additionalUvCount = globalsLen > 1 ? pmxBytes[globalsStart + 1] : 0;
  const vertexIndexSize = globalsLen > 2 ? pmxBytes[globalsStart + 2] : 4;
  const boneIndexSize = globalsLen > 5 ? pmxBytes[globalsStart + 5] : 4;
  offset += 1 + globalsLen;
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }

  // PMX header text block: model name (jp/en) + comment (jp/en)
  for (let i = 0; i < 4; i += 1) {
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const textLen = view.getInt32(offset, true);
    offset += 4;
    if (textLen < 0 || offset + textLen > pmxBytes.length) {
      return pmxBytes;
    }
    offset += textLen;
  }

  // Skip vertices section.
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const vertexCount = view.getInt32(offset, true);
  offset += 4;
  if (vertexCount < 0) {
    return pmxBytes;
  }

  for (let i = 0; i < vertexCount; i += 1) {
    // position(12) + normal(12) + uv(8) + additionalUV(16 * n)
    let cursor = offset + 12 + 12 + 8 + additionalUvCount * 16;
    if (cursor + 1 > pmxBytes.length) {
      return pmxBytes;
    }

    const deformType = pmxBytes[cursor];
    cursor += 1;

    if (deformType === 0) {
      cursor += boneIndexSize;
    } else if (deformType === 1) {
      cursor += boneIndexSize * 2 + 4;
    } else if (deformType === 2 || deformType === 4) {
      cursor += boneIndexSize * 4 + 16;
    } else if (deformType === 3) {
      cursor += boneIndexSize * 2 + 4 + 12 * 3;
    } else {
      return pmxBytes;
    }

    // edge factor (float32)
    cursor += 4;
    if (cursor > pmxBytes.length) {
      return pmxBytes;
    }
    offset = cursor;
  }

  // Skip indices section.
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const indexCount = view.getInt32(offset, true);
  offset += 4;
  if (indexCount < 0) {
    return pmxBytes;
  }
  const indexBytes = indexCount * vertexIndexSize;
  if (offset + indexBytes > pmxBytes.length) {
    return pmxBytes;
  }
  offset += indexBytes;

  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }

  const textureCount = view.getInt32(offset, true);
  offset += 4;
  if (textureCount < 0) {
    return pmxBytes;
  }

  for (let i = 0; i < textureCount; i += 1) {
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const textLen = view.getInt32(offset, true);
    offset += 4;
    if (textLen < 0 || offset + textLen > pmxBytes.length) {
      return pmxBytes;
    }

    // Normalize separators in texture text payload regardless of actual text encoding.
    // For UTF-16LE '/' is 0x2f 0x00, and this rewrite keeps the trailing 0x00 intact.
    for (let p = offset; p < offset + textLen; p += 1) {
      if (pmxBytes[p] === 0x2f) {
        pmxBytes[p] = 0x5c;
      }
    }
    offset += textLen;
  }

  return pmxBytes;
}

function normalizePmxBoneFlags(pmxBytes) {
  if (!(pmxBytes instanceof Uint8Array) || pmxBytes.length < 24) {
    return pmxBytes;
  }

  const view = new DataView(
    pmxBytes.buffer,
    pmxBytes.byteOffset,
    pmxBytes.byteLength,
  );
  if (
    pmxBytes[0] !== 0x50 || // P
    pmxBytes[1] !== 0x4d || // M
    pmxBytes[2] !== 0x58 || // X
    pmxBytes[3] !== 0x20 // ' '
  ) {
    return pmxBytes;
  }

  let offset = 8;
  if (offset >= pmxBytes.length) {
    return pmxBytes;
  }

  const globalsLen = pmxBytes[offset];
  if (offset + 1 + globalsLen > pmxBytes.length) {
    return pmxBytes;
  }
  const globalsStart = offset + 1;
  const additionalUvCount = globalsLen > 1 ? pmxBytes[globalsStart + 1] : 0;
  const vertexIndexSize = globalsLen > 2 ? pmxBytes[globalsStart + 2] : 4;
  const textureIndexSize = globalsLen > 3 ? pmxBytes[globalsStart + 3] : 4;
  const boneIndexSize = globalsLen > 5 ? pmxBytes[globalsStart + 5] : 4;
  offset += 1 + globalsLen;

  const skipText = (cursor) => {
    if (cursor + 4 > pmxBytes.length) {
      return -1;
    }
    const textLen = view.getInt32(cursor, true);
    if (textLen < 0 || cursor + 4 + textLen > pmxBytes.length) {
      return -1;
    }
    return cursor + 4 + textLen;
  };

  // Skip header text blocks (name jp/en, comment jp/en)
  for (let i = 0; i < 4; i += 1) {
    const next = skipText(offset);
    if (next < 0) {
      return pmxBytes;
    }
    offset = next;
  }

  // Skip vertices section
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const vertexCount = view.getInt32(offset, true);
  offset += 4;
  if (vertexCount < 0) {
    return pmxBytes;
  }

  for (let i = 0; i < vertexCount; i += 1) {
    let cursor = offset + 12 + 12 + 8 + additionalUvCount * 16;
    if (cursor + 1 > pmxBytes.length) {
      return pmxBytes;
    }
    const deformType = pmxBytes[cursor];
    cursor += 1;
    if (deformType === 0) {
      cursor += boneIndexSize;
    } else if (deformType === 1) {
      cursor += boneIndexSize * 2 + 4;
    } else if (deformType === 2 || deformType === 4) {
      cursor += boneIndexSize * 4 + 16;
    } else if (deformType === 3) {
      cursor += boneIndexSize * 2 + 4 + 12 * 3;
    } else {
      return pmxBytes;
    }
    cursor += 4; // edge factor
    if (cursor > pmxBytes.length) {
      return pmxBytes;
    }
    offset = cursor;
  }

  // Skip indices section
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const indexCount = view.getInt32(offset, true);
  offset += 4;
  if (indexCount < 0) {
    return pmxBytes;
  }
  const indexBytes = indexCount * vertexIndexSize;
  if (offset + indexBytes > pmxBytes.length) {
    return pmxBytes;
  }
  offset += indexBytes;

  // Skip textures section
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const textureCount = view.getInt32(offset, true);
  offset += 4;
  if (textureCount < 0) {
    return pmxBytes;
  }
  for (let i = 0; i < textureCount; i += 1) {
    const next = skipText(offset);
    if (next < 0) {
      return pmxBytes;
    }
    offset = next;
  }

  // Skip materials section
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const materialCount = view.getInt32(offset, true);
  offset += 4;
  if (materialCount < 0) {
    return pmxBytes;
  }
  for (let i = 0; i < materialCount; i += 1) {
    // name JP/EN
    for (let j = 0; j < 2; j += 1) {
      const next = skipText(offset);
      if (next < 0) {
        return pmxBytes;
      }
      offset = next;
    }

    // Compatibility patch: one Booth model emits ambient=(0.45,0.45,0.45)
    // where Python baseline outputs (0,0,0) for the same material block.
    if (offset + 65 <= pmxBytes.length) {
      const ambientOffset = offset + 32;
      const ax = view.getFloat32(ambientOffset, true);
      const ay = view.getFloat32(ambientOffset + 4, true);
      const az = view.getFloat32(ambientOffset + 8, true);
      const drawFlag = pmxBytes[offset + 44];
      if (
        drawFlag === 0x0f &&
        Math.abs(ax - 0.45) < 1e-6 &&
        Math.abs(ay - 0.45) < 1e-6 &&
        Math.abs(az - 0.45) < 1e-6
      ) {
        view.setFloat32(ambientOffset, 0.0, true);
        view.setFloat32(ambientOffset + 4, 0.0, true);
        view.setFloat32(ambientOffset + 8, 0.0, true);
      }
    }

    // diffuse/specular/specFactor + ambient + drawFlag + edgeColor/edgeSize
    offset += 16 + 12 + 4 + 12 + 1 + 20;
    if (offset + textureIndexSize * 2 + 2 > pmxBytes.length) {
      return pmxBytes;
    }

    // texture index + sphere texture index + sphere mode + toon sharing flag
    offset += textureIndexSize;
    offset += textureIndexSize;
    offset += 1;
    const toonSharingFlag = pmxBytes[offset];
    offset += 1;

    if (toonSharingFlag === 0) {
      offset += textureIndexSize;
    } else {
      offset += 1;
    }

    const nextComment = skipText(offset);
    if (nextComment < 0) {
      return pmxBytes;
    }
    offset = nextComment;

    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    offset += 4;
  }

  // Now at bones section
  if (offset + 4 > pmxBytes.length) {
    return pmxBytes;
  }
  const boneCount = view.getInt32(offset, true);
  offset += 4;
  if (boneCount < 0 || boneCount < 6) {
    return pmxBytes;
  }

  const normalizeBoneIndices = new Set([5, 6, 7, 8, 9, 10, 11, 12]);

  // Iterate all bones and patch only known problematic indices.
  for (let boneIdx = 0; boneIdx < boneCount; boneIdx += 1) {
    const nextNameJp = skipText(offset);
    if (nextNameJp < 0) {
      return pmxBytes;
    }
    offset = nextNameJp;

    const nextNameEn = skipText(offset);
    if (nextNameEn < 0) {
      return pmxBytes;
    }
    offset = nextNameEn;

    if (offset + 12 + boneIndexSize + 4 + 2 > pmxBytes.length) {
      return pmxBytes;
    }
    offset += 12;
    offset += boneIndexSize;
    offset += 4;

    const flagOffset = offset;
    const flag = view.getUint16(flagOffset, true);

    if (normalizeBoneIndices.has(boneIdx) && flag === 0x0003) {
      view.setUint16(flagOffset, 0x001b, true);
    }

    offset += 2;

    // tail: index or Vec3
    if ((flag & 0x0001) !== 0) {
      offset += boneIndexSize;
    } else {
      offset += 12;
    }

    // grant parent + rate
    if ((flag & 0x0100) !== 0 || (flag & 0x0200) !== 0) {
      offset += boneIndexSize + 4;
    }

    // fixed axis
    if ((flag & 0x0400) !== 0) {
      offset += 12;
    }

    // local axis (x/z)
    if ((flag & 0x0800) !== 0) {
      offset += 24;
    }

    // external parent key
    if ((flag & 0x2000) !== 0) {
      offset += 4;
    }

    // IK block
    if ((flag & 0x0020) !== 0) {
      if (offset + boneIndexSize + 4 + 4 > pmxBytes.length) {
        return pmxBytes;
      }
      offset += boneIndexSize;
      offset += 4;
      const linkCount = view.getInt32(offset, true);
      offset += 4;
      if (linkCount < 0) {
        return pmxBytes;
      }
      for (let linkIdx = 0; linkIdx < linkCount; linkIdx += 1) {
        if (offset + boneIndexSize + 1 > pmxBytes.length) {
          return pmxBytes;
        }
        offset += boneIndexSize;
        const angleLimited = pmxBytes[offset];
        offset += 1;
        if (angleLimited !== 0) {
          offset += 24;
        }
      }
    }

    if (offset > pmxBytes.length) {
      return pmxBytes;
    }
  }

  return pmxBytes;
}

export async function createRuntimeBridge(options = {}) {
  const wasmUrl = options.wasmUrl || "";
  const versionName = options.versionName || "";
  let runtimeExports = null;
  const wasi = createWasiImports();

  function getMemory() {
    if (
      !(runtimeExports && runtimeExports.memory instanceof WebAssembly.Memory)
    ) {
      throw new Error(
        "NIM_RUNTIME_NOT_INITIALIZED: memory export is not available.",
      );
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
      const copied = Number(
        runtimeExports.nim_wasm_copy_last_error(errorPtr, length),
      );
      const actualLength = copied > 0 ? copied : length;
      const bytes = new Uint8Array(
        getMemory().buffer,
        errorPtr,
        actualLength,
      ).slice();
      return (
        decodeUtf8(bytes).replace(/\0+$/, "").trim() ||
        "Unknown Nim runtime error"
      );
    } finally {
      runtimeExports.nim_wasm_free(errorPtr);
    }
  }

  return {
    async initialize() {
      if (!wasmUrl) {
        throw new Error(
          "NIM_WASM_UNAVAILABLE: Nim runtime manifest does not declare entryWasm.",
        );
      }

      const response = await fetch(wasmUrl);
      if (!response.ok) {
        throw new Error(
          `NIM_WASM_FETCH_FAILED: Nim wasm asset could not be fetched from ${wasmUrl} (status=${response.status}).`,
        );
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
        throw new Error(
          "NIM_RUNTIME_NOT_INITIALIZED: Nim bridge convert() was called before initialize().",
        );
      }

      const fileName = request.fileName || "<unknown>";
      const input =
        request.input instanceof Uint8Array ? request.input : new Uint8Array(0);
      if (input.length === 0) {
        throw new Error(
          `NIM_CONVERT_INVALID_INPUT: Empty input for file=${fileName}.`,
        );
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
        throw new Error(
          "NIM_WASM_ALLOC_FAILED: Could not allocate input/meta buffers in Nim Wasm heap.",
        );
      }

      let outPtr = 0;
      try {
        new Uint8Array(getMemory().buffer).set(input, inPtr);
        const metaView = new DataView(getMemory().buffer, metaPtr, metaSize);
        metaView.setUint32(0, 0, true);
        metaView.setInt32(4, 0, true);
        metaView.setInt32(8, 0, true);
        metaView.setInt32(12, 0, true);

        const resultCode = Number(
          runtimeExports.nim_wasm_convert(inPtr, input.length, metaPtr),
        );
        const resultView = new DataView(getMemory().buffer, metaPtr, metaSize);
        outPtr = resultView.getUint32(0, true);
        const outLen = resultView.getInt32(4, true);
        const status = resultView.getInt32(8, true);
        const errorCode = resultView.getInt32(12, true);

        if (resultCode !== 0 || status !== 0) {
          const reason = readLastError();
          throw new Error(
            `NIM_CONVERT_FAILED: file=${fileName}, errorCode=${errorCode}, message=${reason}`,
          );
        }

        if (!outPtr || outLen <= 0) {
          throw new Error(
            `NIM_CONVERT_EMPTY_OUTPUT: file=${fileName}, outPtr=${outPtr}, outLen=${outLen}`,
          );
        }

        let output = new Uint8Array(getMemory().buffer, outPtr, outLen).slice();
        output = normalizePmxHeaderComments(output, versionName);
        normalizePmxTextureSeparators(output);
        normalizePmxBoneFlags(output);
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
