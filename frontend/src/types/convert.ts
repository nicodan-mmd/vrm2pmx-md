export type WorkerRequest = {
  id: string;
  type: "convert";
  fileName: string;
  fileBuffer: ArrayBuffer;
};

export type WorkerSuccessResponse = {
  id: string;
  status: "ok";
  usedMode: "wasm";
  fileExtension: "pmx";
  outputBuffer: ArrayBuffer;
};

export type WorkerErrorResponse = {
  id: string;
  status: "error";
  code: string;
  message: string;
};

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;
