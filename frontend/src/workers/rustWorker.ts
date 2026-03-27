/// <reference lib="webworker" />

import { getRustRuntimeAvailability } from "../rust/runtime";
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
    const availability = await getRustRuntimeAvailability();

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
      message: availability.available
        ? "Rust runtime manifest found, but execution bridge is not implemented yet."
        : "Rust runtime assets are not available yet. Falling back is required.",
    };
    workerSelf.postMessage(convertResponse);

    const detail = availability.available
      ? "RUST_CONVERT_NOT_IMPLEMENTED: Rust runtime manifest is present, but execution bridge is not implemented yet."
      : `RUST_RUNTIME_UNAVAILABLE: ${availability.reason ?? "Rust runtime manifest is unavailable."}`;
    postLog("warn", [detail]);
    postLog("info", [`Rust manifest URL: ${availability.manifestUrl}`]);

    const errorResponse: WorkerResponse = {
      id: request.id,
      status: "error",
      code: availability.available ? "RUST_CONVERT_NOT_IMPLEMENTED" : "RUST_RUNTIME_UNAVAILABLE",
      message: detail,
    };
    workerSelf.postMessage(errorResponse);
  } finally {
    activeRequestId = null;
  }
};