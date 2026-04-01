export type WorkerRequest = {
  id: string;
  type: "convert";
  fileName: string;
  fileBuffer: ArrayBuffer;
};

export type WorkerProgressStage =
  | "init"
  | "pyodide-loading"
  | "py-src-sync"
  | "converting"
  | "finalizing";

export type WorkerProgressResponse = {
  id: string;
  status: "progress";
  stage: WorkerProgressStage;
  message: string;
};

export type WorkerSuccessResponse = {
  id: string;
  status: "ok";
  usedMode: "wasm" | "rust";
  fileExtension: "pmx" | "zip";
  outputBuffer: ArrayBuffer;
};

export type WorkerErrorResponse = {
  id: string;
  status: "error";
  code: string;
  message: string;
};

export type WorkerLogResponse = {
  id: string;
  status: "log";
  level: "log" | "info" | "warn" | "error" | "debug";
  args: string[];
};

export type WorkerResponse =
  | WorkerProgressResponse
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerLogResponse;

export type WorkerTerminalResponse = WorkerSuccessResponse | WorkerErrorResponse;
