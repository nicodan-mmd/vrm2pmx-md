import { getPyodideVersion } from "../wasm/pyodideRuntime";

export type ConvertMode = "auto" | "backend" | "wasm";

export type ConvertResult = {
  blob: Blob;
  fileExtension: "zip" | "pmx";
  usedMode: "backend" | "wasm";
  fallbackReason?: string;
};

const API_BASE = "http://127.0.0.1:8000";

async function convertViaBackend(file: File): Promise<ConvertResult> {
  const formData = new FormData();
  formData.append("vrm_file", file);

  const response = await fetch(`${API_BASE}/api/convert`, {
    method: "POST",
    body: formData,
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

async function convertViaWasm(_file: File): Promise<ConvertResult> {
  const pyodideVersion = await getPyodideVersion();
  throw new Error(
    `Wasm runtime is ready (Pyodide ${pyodideVersion}), but conversion bridge is not implemented yet.`,
  );
}

export async function convertWithMode(
  file: File,
  mode: ConvertMode,
): Promise<ConvertResult> {
  const startedAt = performance.now();

  if (mode === "backend") {
    const result = await convertViaBackend(file);
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
    const result = await convertViaWasm(file);
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
    const wasmResult = await convertViaWasm(file);
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
    const fallbackReason =
      error instanceof Error ? error.message : "Unknown wasm error";

    const backendResult = await convertViaBackend(file);
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
