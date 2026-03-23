import { getPyodideVersion } from "../wasm/pyodideRuntime";
import type { WorkerRequest, WorkerResponse } from "../types/convert";

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type !== "convert") {
    return;
  }

  try {
    const pyodideVersion = await getPyodideVersion();
    const sizeMb = (request.fileBuffer.byteLength / (1024 * 1024)).toFixed(1);

    throw new Error(
      `Wasm worker is ready (Pyodide ${pyodideVersion}, input ${sizeMb}MB), but conversion bridge is not implemented yet.`,
    );
  } catch (error) {
    const response: WorkerResponse = {
      id: request.id,
      status: "error",
      code: "WASM_NOT_IMPLEMENTED",
      message: error instanceof Error ? error.message : "Unknown wasm worker error",
    };
    self.postMessage(response);
  }
};
