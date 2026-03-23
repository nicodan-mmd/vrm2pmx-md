import type { WorkerRequest, WorkerResponse } from "../types/convert";

const worker = new Worker(new URL("../workers/convertWorker.ts", import.meta.url), {
  type: "module",
});

type PendingTask = {
  resolve: (response: WorkerResponse) => void;
  reject: (reason?: unknown) => void;
};

const pending = new Map<string, PendingTask>();

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const response = event.data;
  const task = pending.get(response.id);
  if (!task) {
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
): Promise<WorkerResponse> {
  const id = crypto.randomUUID();
  const request: WorkerRequest = {
    id,
    type: "convert",
    fileName,
    fileBuffer,
  };

  return new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage(request, [fileBuffer]);
  });
}
