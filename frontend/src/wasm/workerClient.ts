import type {
  WorkerProgressResponse,
  WorkerRequest,
  WorkerResponse,
  WorkerTerminalResponse,
} from "../types/convert";

function createWorker(): Worker {
  return new Worker(new URL("../workers/convertWorker.ts", import.meta.url), {
    type: "module",
  });
}

type PendingTask = {
  id: string;
  resolve: (response: WorkerTerminalResponse) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (response: WorkerProgressResponse) => void;
};

const pending = new Map<string, PendingTask>();
let worker = createWorker();

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function resetWorker(reason?: Error): void {
  worker.terminate();
  pending.forEach((task) => {
    task.reject(reason ?? new Error("Wasm worker reset"));
  });
  pending.clear();
  worker = createWorker();
  bindWorkerHandlers();
}

function bindWorkerHandlers(): void {
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
    resetWorker(event.error ?? new Error("Wasm worker crashed"));
  };
}

bindWorkerHandlers();

export async function convertViaWasmWorker(
  fileName: string,
  fileBuffer: ArrayBuffer,
  onProgress?: (response: WorkerProgressResponse) => void,
  signal?: AbortSignal,
): Promise<WorkerTerminalResponse> {
  const id = crypto.randomUUID();
  const request: WorkerRequest = {
    id,
    type: "convert",
    fileName,
    fileBuffer,
  };

  return new Promise<WorkerTerminalResponse>((resolve, reject) => {
    const task: PendingTask = { id, resolve, reject, onProgress };
    pending.set(id, task);

    const onAbort = () => {
      if (!pending.has(id)) {
        return;
      }
      pending.delete(id);
      reject(createAbortError("Conversion canceled by user"));
      resetWorker(createAbortError("Conversion canceled by user"));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });

    worker.postMessage(request, [fileBuffer]);
  });
}
