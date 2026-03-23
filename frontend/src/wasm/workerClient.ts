import type {
  WorkerProgressResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerTerminalResponse,
} from "../types/convert";

const worker = new Worker(new URL("../workers/convertWorker.ts", import.meta.url), {
  type: "module",
});

type PendingTask = {
  resolve: (response: WorkerTerminalResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (response: WorkerProgressResponse) => void;
};

const pending = new Map<string, PendingTask>();

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  const task = pending.get(response.id);
  if (!task) {
    return;
  }

  if (response.status === "progress") {
    task.onProgress?.(response);
    return;
  }

  pending.delete(response.id);
  task.resolve(response);
};

worker.onerror = (event) => {
  pending.forEach((task) => {
    task.reject(event.error ?? new Error("Wasm worker crashed"));
  });
  pending.clear();
};

export async function convertViaWasmWorker(
  fileName: string,
  fileBuffer: ArrayBuffer,
  onProgress?: (response: WorkerProgressResponse) => void,
): Promise<WorkerTerminalResponse> {
  const id = crypto.randomUUID();
  const request: WorkerRequest = {
    id,
    type: "convert",
    fileName,
    fileBuffer,
  };

  return new Promise<WorkerTerminalResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage(request, [fileBuffer]);
  });
}
