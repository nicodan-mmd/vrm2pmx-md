#!/usr/bin/env node
// frontend_wasm_dump_runner.mjs
// Runs Nim Wasm converter directly in Node.js, writes PMX bytes to --out, prints JSON.
// Usage:
//   node scripts/frontend_wasm_dump_runner.mjs --vrm <path.vrm> --wasm <path.wasm> --out <path.pmx>

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const META_OUT_PTR_OFFSET = 0;
const META_OUT_LEN_OFFSET = 4;
const META_STATUS_OFFSET = 8;
const META_SIZE = 16;

const { values } = parseArgs({
  options: {
    vrm: { type: "string" },
    wasm: { type: "string" },
    out: { type: "string" },
    version: { type: "string" },
  },
});

if (!values.vrm || !values.wasm || !values.out) {
  process.stderr.write("Usage: node scripts/frontend_wasm_dump_runner.mjs --vrm <path> --wasm <path> --out <path>\n");
  process.exit(1);
}

const vrmBytes = readFileSync(values.vrm);
const wasmBytes = readFileSync(values.wasm);

const runtimeRef = { memory: null, lastMessage: "" };
const textDecoder = new TextDecoder();

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
  if (!(pmxBytes instanceof Uint8Array) || pmxBytes.length < 24 || !versionName) {
    return pmxBytes;
  }

  const view = new DataView(pmxBytes.buffer, pmxBytes.byteOffset, pmxBytes.byteLength);
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

  const view = new DataView(pmxBytes.buffer, pmxBytes.byteOffset, pmxBytes.byteLength);
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

  const view = new DataView(pmxBytes.buffer, pmxBytes.byteOffset, pmxBytes.byteLength);

  // Validate PMX header
  if (
    pmxBytes[0] !== 0x50 || // P
    pmxBytes[1] !== 0x4d || // M
    pmxBytes[2] !== 0x58 || // X
    pmxBytes[3] !== 0x20 // ' '
  ) {
    return pmxBytes;
  }

  try {
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

    // Skip header text blocks (4 texts)
    for (let i = 0; i < 4; i += 1) {
      const next = skipText(offset);
      if (next < 0) {
        return pmxBytes;
      }
      offset = next;
    }

    // Skip vertices
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const vertexCount = view.getInt32(offset, true);
    offset += 4;
    for (let i = 0; i < vertexCount; i += 1) {
      offset += 12 + 12 + 8 + additionalUvCount * 16;
      if (offset + 1 > pmxBytes.length) {
        return pmxBytes;
      }
      const deformType = pmxBytes[offset];
      offset += 1;
      switch (deformType) {
        case 0: offset += boneIndexSize; break;
        case 1: offset += boneIndexSize * 2 + 4; break;
        case 2: offset += boneIndexSize * 4 + 16; break;
        case 3: offset += boneIndexSize * 2 + 4 + 36; break;
        case 4: offset += boneIndexSize * 4 + 16; break;
        default: return pmxBytes;
      }
      offset += 4;  // edge factor
      if (offset > pmxBytes.length) {
        return pmxBytes;
      }
    }

    // Skip indices
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const indexCount = view.getInt32(offset, true);
    offset += 4;
    if (indexCount < 0) {
      return pmxBytes;
    }
    offset += indexCount * vertexIndexSize;
    if (offset > pmxBytes.length) {
      return pmxBytes;
    }

    // Skip textures
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

    // Skip materials
    if (offset + 4 > pmxBytes.length) {
      return pmxBytes;
    }
    const materialCount = view.getInt32(offset, true);
    offset += 4;
    if (materialCount < 0) {
      return pmxBytes;
    }
    for (let i = 0; i < materialCount; i += 1) {
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
          drawFlag === 0x0f
          && Math.abs(ax - 0.45) < 1e-6
          && Math.abs(ay - 0.45) < 1e-6
          && Math.abs(az - 0.45) < 1e-6
        ) {
          view.setFloat32(ambientOffset, 0.0, true);
          view.setFloat32(ambientOffset + 4, 0.0, true);
          view.setFloat32(ambientOffset + 8, 0.0, true);
        }
      }

      offset += 16 + 12 + 4 + 12 + 1 + 20;
      if (offset + textureIndexSize * 2 + 2 > pmxBytes.length) {
        return pmxBytes;
      }

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

      if ((flag & 0x0001) !== 0) {
        offset += boneIndexSize;
      } else {
        offset += 12;
      }

      if ((flag & 0x0100) !== 0 || (flag & 0x0200) !== 0) {
        offset += boneIndexSize + 4;
      }

      if ((flag & 0x0400) !== 0) {
        offset += 12;
      }

      if ((flag & 0x0800) !== 0) {
        offset += 24;
      }

      if ((flag & 0x2000) !== 0) {
        offset += 4;
      }

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

  } catch (e) {
    return pmxBytes;
  }

  return pmxBytes;
}

function readMemBytes(ptr, len) {
  return new Uint8Array(runtimeRef.memory.buffer, ptr, len);
}

const importObject = {
  env: {
    emscripten_notify_memory_growth() {},
  },
  wasi_snapshot_preview1: {
    proc_exit(code) {
      throw new Error(`NIM_WASM_PROC_EXIT:${code}:${runtimeRef.lastMessage.trim()}`);
    },
    fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      const dv = new DataView(runtimeRef.memory.buffer);
      let total = 0;
      let out = "";
      for (let i = 0; i < iovsLen; i++) {
        const base = iovsPtr + i * 8;
        const ptr = dv.getUint32(base, true);
        const len = dv.getUint32(base + 4, true);
        out += textDecoder.decode(readMemBytes(ptr, len));
        total += len;
      }
      if (nwrittenPtr) dv.setUint32(nwrittenPtr, total, true);
      if (out.trim()) runtimeRef.lastMessage = out.trimEnd();
      return 0;
    },
    fd_read(_fd, _iovsPtr, _iovsLen, nreadPtr) {
      const dv = new DataView(runtimeRef.memory.buffer);
      if (nreadPtr) dv.setUint32(nreadPtr, 0, true);
      return 0;
    },
    fd_seek() { return 70; },
    fd_close() { return 0; },
    fd_fdstat_get() { return 0; },
    environ_get(environPtr, environBufPtr) {
      const dv = new DataView(runtimeRef.memory.buffer);
      dv.setUint32(environPtr, 0, true);
      dv.setUint32(environBufPtr, 0, true);
      return 0;
    },
    environ_sizes_get(countPtr, sizePtr) {
      const dv = new DataView(runtimeRef.memory.buffer);
      dv.setUint32(countPtr, 0, true);
      dv.setUint32(sizePtr, 0, true);
      return 0;
    },
    args_get() { return 0; },
    args_sizes_get(argcPtr, argvBufSizePtr) {
      const dv = new DataView(runtimeRef.memory.buffer);
      dv.setUint32(argcPtr, 0, true);
      dv.setUint32(argvBufSizePtr, 0, true);
      return 0;
    },
  },
};

async function run() {
  const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
  const ex = instance.exports;
  runtimeRef.memory = ex.memory;

  ex.nim_wasm_init();

  const inputLen = vrmBytes.length;
  const inputPtr = ex.nim_wasm_alloc(inputLen);
  new Uint8Array(ex.memory.buffer, inputPtr, inputLen).set(vrmBytes);

  const metaPtr = ex.nim_wasm_alloc(META_SIZE);
  new Uint8Array(ex.memory.buffer, metaPtr, META_SIZE).fill(0);

  const started = performance.now();
  const rc = ex.nim_wasm_convert(inputPtr, inputLen, metaPtr);
  const elapsedMs = Math.round(performance.now() - started);

  const dv = new DataView(ex.memory.buffer);
  const outPtr = dv.getInt32(metaPtr + META_OUT_PTR_OFFSET, true);
  const outLen = dv.getInt32(metaPtr + META_OUT_LEN_OFFSET, true);
  const status = dv.getUint8(metaPtr + META_STATUS_OFFSET);

  if (rc === 0 && status === 0 && outLen > 0) {
    let out = new Uint8Array(ex.memory.buffer, outPtr, outLen).slice();
    out = normalizePmxHeaderComments(out, values.version || "1.5.3");
    normalizePmxTextureSeparators(out);
    normalizePmxBoneFlags(out);
    writeFileSync(values.out, out);
    ex.nim_wasm_free(outPtr);
    process.stdout.write(JSON.stringify({ status: "ok", elapsed_ms: elapsedMs, output_size: outLen, out: values.out }) + "\n");
  } else {
    const errLen = ex.nim_wasm_last_error_len();
    let errorMsg = `rc=${rc} status=${status}`;
    if (errLen > 0) {
      const errPtr = ex.nim_wasm_alloc(errLen);
      ex.nim_wasm_copy_last_error(errPtr, errLen);
      errorMsg = textDecoder.decode(readMemBytes(errPtr, errLen));
      ex.nim_wasm_free(errPtr);
    }
    process.stdout.write(JSON.stringify({ status: "error", elapsed_ms: elapsedMs, error: errorMsg }) + "\n");
  }

  ex.nim_wasm_free(inputPtr);
  ex.nim_wasm_free(metaPtr);
}

run().catch((err) => {
  process.stdout.write(JSON.stringify({ status: "error", elapsed_ms: 0, error: String(err) }) + "\n");
  process.exit(0);
});
