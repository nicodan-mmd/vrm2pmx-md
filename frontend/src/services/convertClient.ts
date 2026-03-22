import { getPyodideVersion } from "../wasm/pyodideRuntime";

export type ConvertMode = "backend" | "wasm";

const API_BASE = "http://127.0.0.1:8000";

export async function convertViaBackend(file: File): Promise<Blob> {
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

  return response.blob();
}

export async function convertViaWasm(_file: File): Promise<Blob> {
  const pyodideVersion = await getPyodideVersion();
  throw new Error(
    `Wasm runtime is ready (Pyodide ${pyodideVersion}), but conversion bridge is not implemented yet.`,
  );
}
