import { convertViaWasmWorker } from "../wasm/workerClient";
import type { WorkerProgressResponse } from "../types/convert";

export type ConvertMode = "auto" | "backend" | "wasm";

export type ConvertResult = {
  blob: Blob;
  fileExtension: "zip" | "pmx";
  usedMode: "backend" | "wasm";
  fallbackReason?: string;
};

export type ConvertProgress = {
  stage: WorkerProgressResponse["stage"];
  message: string;
};

type ConvertOptions = {
  onProgress?: (progress: ConvertProgress) => void;
  signal?: AbortSignal;
};

type UserErrorContext = {
  mode: ConvertMode;
  backendEnabled: boolean;
};

const API_BASE = "http://127.0.0.1:8000";
const BACKEND_FALLBACK_ENABLED =
  import.meta.env.VITE_ENABLE_BACKEND_FALLBACK === "true";

export function isBackendFallbackEnabled(): boolean {
  return BACKEND_FALLBACK_ENABLED;
}

export function toUserFriendlyConvertError(
  error: unknown,
  context: UserErrorContext,
): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Conversion canceled.";
  }

  const rawMessage = error instanceof Error ? error.message : "Unknown error";
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("out of memory") ||
    normalized.includes("memory") ||
    normalized.includes("allocation")
  ) {
    return "Conversion failed due to insufficient memory. Try a smaller model, close other browser tabs, or reload the page and retry.";
  }

  if (normalized.includes("failed to fetch")) {
    if (context.mode === "backend") {
      return "Backend server is not reachable. Start FastAPI on 127.0.0.1:8000, or switch to Wasm mode.";
    }

    if (context.mode === "auto" && context.backendEnabled) {
      return "Wasm conversion failed and backend fallback was also not reachable. Check network/backend state and retry.";
    }

    return "Required runtime files could not be fetched. Check network access and retry.";
  }

  if (normalized.includes("backend fallback is disabled")) {
    return "Wasm conversion failed and backend fallback is disabled in this build.";
  }

  if (normalized.includes("no known package") || normalized.includes("pillow")) {
    return "Pyodide package initialization failed. Reload the page and retry. If it persists, check network access to cdn.jsdelivr.net.";
  }

  if (normalized.includes("no module named 'quaternion'")) {
    return "Wasm runtime was missing quaternion support, but a compatibility fallback has been added. Reload the page and try again.";
  }

  if (normalized.includes("failed to fetch py_src_manifest")) {
    return "Python runtime manifest could not be loaded. Run npm run dev/build again to regenerate synced py_src files.";
  }

  if (normalized.includes("invalid vrm") || normalized.includes("file_suffix")) {
    return "The selected file format is not supported or the VRM/GLB content is invalid.";
  }

  if (normalized.includes("wasm_convert_failed") || normalized.includes("pyodide")) {
    return "Wasm runtime error occurred during conversion. Reload the page and try again.";
  }

  return rawMessage;
}

async function convertViaBackend(
  file: File,
  options?: ConvertOptions,
): Promise<ConvertResult> {
  const formData = new FormData();
  formData.append("vrm_file", file);

  const response = await fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorBody = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(errorBody.detail ?? "Request failed");
  }

  return {
    blob: await response.blob(),
    fileExtension: "zip",
    usedMode: "backend",
  };
}

async function convertViaWasm(
  file: File,
  options?: ConvertOptions,
): Promise<ConvertResult> {
  const inputBuffer = await file.arrayBuffer();
  const response = await convertViaWasmWorker(
    file.name,
    inputBuffer,
    (event) => {
      options?.onProgress?.({ stage: event.stage, message: event.message });
    },
    options?.signal,
  );

  if (response.status === "error") {
    throw new Error(response.message);
  }

  return {
    blob: new Blob([response.outputBuffer], { type: "application/octet-stream" }),
    fileExtension: response.fileExtension,
    usedMode: response.usedMode,
  };
}

export async function convertWithMode(
  file: File,
  mode: ConvertMode,
  options?: ConvertOptions,
): Promise<ConvertResult> {
  const startedAt = performance.now();

  if (mode === "backend") {
    const result = await convertViaBackend(file, options);
    console.info(
      JSON.stringify({
        event: "convert.completed",
        requestedMode: mode,
        finalMode: result.usedMode,
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
    );
    return result;
  }

  if (mode === "wasm") {
    const result = await convertViaWasm(file, options);
    console.info(
      JSON.stringify({
        event: "convert.completed",
        requestedMode: mode,
        finalMode: result.usedMode,
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
    );
    return result;
  }

  try {
    const wasmResult = await convertViaWasm(file, options);
    console.info(
      JSON.stringify({
        event: "convert.completed",
        requestedMode: mode,
        finalMode: wasmResult.usedMode,
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
    );
    return wasmResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    const fallbackReason =
      error instanceof Error ? error.message : "Unknown wasm error";

    if (!BACKEND_FALLBACK_ENABLED) {
      console.info(
        JSON.stringify({
          event: "convert.wasm.failed",
          requestedMode: mode,
          attemptedMode: "wasm",
          fallbackEnabled: false,
          fallbackReason,
          elapsedMs: Math.round(performance.now() - startedAt),
        }),
      );

      throw new Error(
        `Wasm conversion failed and backend fallback is disabled. Reason: ${fallbackReason}`,
      );
    }

    const backendResult = await convertViaBackend(file, options);
    console.info(
      JSON.stringify({
        event: "convert.fallback.completed",
        requestedMode: mode,
        attemptedMode: "wasm",
        fallbackMode: "backend",
        fallbackReason,
        finalMode: backendResult.usedMode,
        elapsedMs: Math.round(performance.now() - startedAt),
      }),
    );

    return {
      ...backendResult,
      fallbackReason,
    };
  }
}
