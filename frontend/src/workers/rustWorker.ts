/// <reference lib="webworker" />

import { loadRustRuntimeBridge } from "../rust/bridge";
import type {
  WorkerLogResponse,
  WorkerRequest,
  WorkerResponse,
} from "../types/convert";

const workerSelf: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
let activeRequestId: string | null = null;

function postLog(level: WorkerLogResponse["level"], args: string[]): void {
  if (!activeRequestId) {
    return;
  }

  const response: WorkerLogResponse = {
    id: activeRequestId,
    status: "log",
    level,
    args,
  };
  workerSelf.postMessage(response);
}

workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== "convert") {
    return;
  }

  activeRequestId = request.id;

  try {
    const initResponse: WorkerResponse = {
      id: request.id,
      status: "progress",
      stage: "init",
      message: "Initializing Rust conversion worker...",
    };
    workerSelf.postMessage(initResponse);

    const convertResponse: WorkerResponse = {
      id: request.id,
      status: "progress",
      stage: "converting",
      message: "Loading Rust runtime bridge...",
    };
    workerSelf.postMessage(convertResponse);

    const { manifest, bridge } = await loadRustRuntimeBridge();
    postLog("info", [`Rust loader status: ${manifest.status}`]);
    postLog("info", [`Rust loader entryJs: ${manifest.entryJs}`]);
    postLog("info", [`Rust loader entryWasm: ${manifest.entryWasm || "<empty>"}`]);

    await bridge.initialize();

    const detail = "RUST_CONVERT_NOT_IMPLEMENTED: Rust bridge initialized unexpectedly without conversion implementation.";
    postLog("warn", [detail]);

    const errorResponse: WorkerResponse = {
      id: request.id,
      status: "error",
      code: "RUST_CONVERT_NOT_IMPLEMENTED",
      message: detail,
    };
    workerSelf.postMessage(errorResponse);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Rust worker error";
    postLog("warn", [detail]);

    const errorCode = detail.startsWith("RUST_RUNTIME_UNAVAILABLE")
      ? "RUST_RUNTIME_UNAVAILABLE"
      : detail.startsWith("RUST_BRIDGE_UNAVAILABLE") || detail.startsWith("RUST_BRIDGE_INVALID")
        ? "RUST_BRIDGE_UNAVAILABLE"
        : detail.startsWith("RUST_WASM_UNAVAILABLE") || detail.startsWith("RUST_WASM_NOT_IMPLEMENTED")
          ? "RUST_WASM_UNAVAILABLE"
          : "RUST_CONVERT_NOT_IMPLEMENTED";

    const errorResponse: WorkerResponse = {
      id: request.id,
      status: "error",
      code: errorCode,
      message: detail,
    };
    workerSelf.postMessage(errorResponse);
  } finally {
    activeRequestId = null;
  }
};