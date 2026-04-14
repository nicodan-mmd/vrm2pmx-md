/// <reference lib="webworker" />

import { loadNimRuntimeBridge } from "../nim/bridge";
import type {
  WorkerLogResponse,
  WorkerRequest,
  WorkerResponse,
} from "../types/convert";

const workerSelf: DedicatedWorkerGlobalScope =
  self as DedicatedWorkerGlobalScope;
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
      message: "Initializing Nim conversion worker...",
    };
    workerSelf.postMessage(initResponse);

    const convertResponse: WorkerResponse = {
      id: request.id,
      status: "progress",
      stage: "converting",
      message: "Loading Nim runtime bridge...",
    };
    workerSelf.postMessage(convertResponse);

    const { manifest, bridge } = await loadNimRuntimeBridge();
    postLog("info", [`Nim loader status: ${manifest.status}`]);
    postLog("info", [`Nim loader entryJs: ${manifest.entryJs}`]);
    postLog("info", [
      `Nim loader entryWasm: ${manifest.entryWasm || "<empty>"}`,
    ]);

    await bridge.initialize();
    postLog("info", ["Nim bridge initialized; invoking convert()..."]);

    const result = await bridge.convert({
      fileName: request.fileName,
      input: new Uint8Array(request.fileBuffer),
    });
    const outputBuffer = result.output.slice().buffer;

    const successResponse: WorkerResponse = {
      id: request.id,
      status: "ok",
      usedMode: "nim",
      fileExtension: result.fileExtension,
      outputBuffer,
    };
    workerSelf.postMessage(successResponse, [outputBuffer]);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown Nim worker error";
    postLog("warn", [detail]);

    const errorCode = detail.startsWith("NIM_RUNTIME_UNAVAILABLE")
      ? "NIM_RUNTIME_UNAVAILABLE"
      : detail.startsWith("NIM_BRIDGE_UNAVAILABLE") ||
          detail.startsWith("NIM_BRIDGE_INVALID")
        ? "NIM_BRIDGE_UNAVAILABLE"
        : detail.startsWith("NIM_WASM_UNAVAILABLE") ||
            detail.startsWith("NIM_WASM_FETCH_FAILED") ||
            detail.startsWith("NIM_WASM_INVALID")
          ? "NIM_WASM_UNAVAILABLE"
          : detail.startsWith("NIM_WASM_INIT_FAILED")
            ? "NIM_WASM_INIT_FAILED"
            : "NIM_CONVERT_FAILED";

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
