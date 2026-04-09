/// <reference lib="webworker" />

import { loadNimRuntimeBridge } from "../nim/bridge";
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
    workerSelf.postMessage({
      id: request.id,
      status: "progress",
      stage: "init",
      message: "Initializing Nim Wasm worker...",
    } satisfies WorkerResponse);

    workerSelf.postMessage({
      id: request.id,
      status: "progress",
      stage: "converting",
      message: "Loading Nim Wasm runtime...",
    } satisfies WorkerResponse);

    const { manifest, bridge } = await loadNimRuntimeBridge();
    postLog("info", [`Nim runtime status: ${manifest.status}`]);
    postLog("info", [`Nim runtime entryWasm: ${manifest.entryWasm}`]);

    await bridge.initialize();
    postLog("info", ["Nim bridge initialized; invoking convert()..."]);

    workerSelf.postMessage({
      id: request.id,
      status: "progress",
      stage: "finalizing",
      message: "Packaging PMX output...",
    } satisfies WorkerResponse);

    const result = await bridge.convert({
      fileName: request.fileName,
      input: new Uint8Array(request.fileBuffer),
    });
    const outputBuffer = result.output.slice().buffer;

    workerSelf.postMessage(
      {
        id: request.id,
        status: "ok",
        usedMode: "nim",
        fileExtension: result.fileExtension,
        outputBuffer,
      } satisfies WorkerResponse,
      [outputBuffer],
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown Nim worker error";
    postLog("warn", [detail]);

    workerSelf.postMessage({
      id: request.id,
      status: "error",
      code: detail.startsWith("NIM_RUNTIME_UNAVAILABLE")
        ? "NIM_RUNTIME_UNAVAILABLE"
        : detail.startsWith("NIM_WASM_UNAVAILABLE") || detail.startsWith("NIM_WASM_INVALID")
          ? "NIM_WASM_UNAVAILABLE"
          : "NIM_CONVERT_FAILED",
      message: detail,
    } satisfies WorkerResponse);
  } finally {
    activeRequestId = null;
  }
};