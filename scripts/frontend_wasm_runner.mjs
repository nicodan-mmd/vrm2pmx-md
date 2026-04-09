#!/usr/bin/env node
// frontend_wasm_runner.mjs
// Loads vrm2pmx_nim_runtime.wasm via Node.js and converts a single VRM file.
// Outputs a JSON result to stdout: { elapsed_ms, input_size, output_size, status, error? }
//
// Usage:
//   node scripts/frontend_wasm_runner.mjs --vrm <path.vrm> --wasm <path.wasm>

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
  },
});

if (!values.vrm || !values.wasm) {
  process.stderr.write(
    "Usage: node frontend_wasm_runner.mjs --vrm <path> --wasm <path> [--out <path.pmx>]\n",
  );
  process.exit(1);
}

const vrmBytes = readFileSync(values.vrm);
const wasmBytes = readFileSync(values.wasm);

const runtimeRef = { memory: null, lastMessage: "" };
const textDecoder = new TextDecoder();

function readMemBytes(ptr, len) {
  return new Uint8Array(runtimeRef.memory.buffer, ptr, len);
}

const importObject = {
  env: {
    emscripten_notify_memory_growth() {},
  },
  wasi_snapshot_preview1: {
    proc_exit(code) {
      throw new Error(
        `NIM_WASM_PROC_EXIT:${code}:${runtimeRef.lastMessage.trim()}`,
      );
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
    fd_seek() {
      return 70;
    },
    fd_close() {
      return 0;
    },
    fd_fdstat_get() {
      return 0;
    },
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
    args_get() {
      return 0;
    },
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
  const exports = instance.exports;
  runtimeRef.memory = exports.memory;

  exports.nim_wasm_init();

  const inputLen = vrmBytes.length;
  const inputPtr = exports.nim_wasm_alloc(inputLen);
  new Uint8Array(exports.memory.buffer, inputPtr, inputLen).set(vrmBytes);

  const metaPtr = exports.nim_wasm_alloc(META_SIZE);
  new Uint8Array(exports.memory.buffer, metaPtr, META_SIZE).fill(0);

  const start = performance.now();
  const rc = exports.nim_wasm_convert(inputPtr, inputLen, metaPtr);
  const elapsedMs = Math.round(performance.now() - start);

  const dv = new DataView(exports.memory.buffer);
  const outPtr = dv.getInt32(metaPtr + META_OUT_PTR_OFFSET, true);
  const outLen = dv.getInt32(metaPtr + META_OUT_LEN_OFFSET, true);
  const status = dv.getUint8(metaPtr + META_STATUS_OFFSET);

  let result;
  if (rc === 0 && status === 0 && outLen > 0) {
    if (values.out) {
      const outBytes = Buffer.from(
        new Uint8Array(exports.memory.buffer, outPtr, outLen),
      );
      writeFileSync(values.out, outBytes);
    }
    result = {
      elapsed_ms: elapsedMs,
      input_size: vrmBytes.length,
      output_size: outLen,
      status: "ok",
    };
    exports.nim_wasm_free(outPtr);
  } else {
    const errLen = exports.nim_wasm_last_error_len();
    let errorMsg = `rc=${rc} status=${status}`;
    if (errLen > 0) {
      const errPtr = exports.nim_wasm_alloc(errLen);
      exports.nim_wasm_copy_last_error(errPtr, errLen);
      errorMsg = textDecoder.decode(readMemBytes(errPtr, errLen));
      exports.nim_wasm_free(errPtr);
    }
    result = {
      elapsed_ms: elapsedMs,
      input_size: vrmBytes.length,
      output_size: 0,
      status: "error",
      error: errorMsg,
    };
  }

  exports.nim_wasm_free(inputPtr);
  exports.nim_wasm_free(metaPtr);

  process.stdout.write(JSON.stringify(result) + "\n");
}

run().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      elapsed_ms: 0,
      input_size: vrmBytes?.length ?? 0,
      output_size: 0,
      status: "error",
      error: String(err),
    }) + "\n",
  );
  process.exit(0);
});
