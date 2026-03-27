/// <reference lib="webworker" />

import { getPyodide, getPyodideVersion } from "../wasm/pyodideRuntime";
import type {
  WorkerLogResponse,
  WorkerProgressStage,
  WorkerRequest,
  WorkerResponse,
  WorkerSuccessResponse,
} from "../types/convert";
import { getRuntimeLogLevel, shouldCaptureLog } from "../utils/logging";

const BASE_URL = import.meta.env.BASE_URL;
const APP_BASE_URL = new URL(BASE_URL, self.location.origin);
const PY_SRC_ROOT = new URL("py_src/", APP_BASE_URL);
const PY_SRC_MANIFEST = new URL("py_src_manifest.json", APP_BASE_URL);
const PY_RUNTIME_ROOT = "/workspace/src";
const DEFAULT_PY_LOG_LEVEL = import.meta.env.DEV ? 20 : 40;

function resolvePyLoggingLevel(): number {
  const raw = import.meta.env.VITE_PY_LOG_LEVEL;
  if (!raw) {
    return DEFAULT_PY_LOG_LEVEL;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "debug") {
    return 10;
  }
  if (normalized === "info") {
    return 20;
  }
  if (normalized === "warn" || normalized === "warning") {
    return 30;
  }
  if (normalized === "error") {
    return 40;
  }
  if (normalized === "critical") {
    return 50;
  }

  const asNumber = Number.parseInt(normalized, 10);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber;
  }

  return DEFAULT_PY_LOG_LEVEL;
}

let pyReadyPromise: Promise<void> | null = null;
const PY_LOGGING_LEVEL = resolvePyLoggingLevel();

async function loadCorePackages(pyodide: Awaited<ReturnType<typeof getPyodide>>): Promise<void> {
  await pyodide.loadPackage(["numpy"]);

  try {
    await pyodide.loadPackage(["pillow"]);
  } catch {
    // Some Pyodide environments may expose Pillow under canonical casing.
    await pyodide.loadPackage(["Pillow"]);
  }
}

async function ensurePyRuntime(): Promise<void> {
  if (pyReadyPromise) {
    return pyReadyPromise;
  }

  pyReadyPromise = (async () => {
    const pyodide = await getPyodide();
    await loadCorePackages(pyodide);

    const manifestResponse = await fetch(PY_SRC_MANIFEST.toString());
    if (!manifestResponse.ok) {
      throw new Error("Failed to fetch py_src_manifest.json");
    }

    const files = (await manifestResponse.json()) as string[];
    pyodide.FS.mkdirTree(PY_RUNTIME_ROOT);

    for (const relativePath of files) {
      const sourceUrl = new URL(relativePath, PY_SRC_ROOT);
      const sourceResponse = await fetch(sourceUrl.toString());
      if (!sourceResponse.ok) {
        throw new Error(`Failed to fetch python source: ${relativePath}`);
      }

      const sourceText = await sourceResponse.text();
      const targetPath = `${PY_RUNTIME_ROOT}/${relativePath}`;
      const targetDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
      pyodide.FS.mkdirTree(targetDir);
      pyodide.FS.writeFile(targetPath, sourceText, { encoding: "utf8" });
    }

    pyodide.runPython(`
import sys
if "${PY_RUNTIME_ROOT}" not in sys.path:
    sys.path.insert(0, "${PY_RUNTIME_ROOT}")
`);
  })();

  try {
    return await pyReadyPromise;
  } catch (error) {
    // Allow retry without full page reload when runtime init fails.
    pyReadyPromise = null;
    throw error;
  }
}

const ENABLE_WASM_RUNTIME_PRELOAD = (import.meta.env.VITE_WASM_PRELOAD ?? "true") !== "false";
if (ENABLE_WASM_RUNTIME_PRELOAD) {
  // Best-effort warmup to reduce first convert latency.
  void ensurePyRuntime().catch(() => {
    // If preload fails, conversion path retries on demand.
  });
}

const workerSelf: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;
let activeRequestId: string | null = null;
const WORKER_LOG_LEVEL = getRuntimeLogLevel();
const ENABLE_WORKER_CONSOLE_OUTPUT = WORKER_LOG_LEVEL === "debug";

function stringifyLogArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function postWorkerLog(level: WorkerLogResponse["level"], args: unknown[]): void {
  if (!activeRequestId) {
    return;
  }
  if (!shouldCaptureLog(level, WORKER_LOG_LEVEL)) {
    return;
  }

  const response: WorkerLogResponse = {
    id: activeRequestId,
    status: "log",
    level,
    args: args.map((value) => stringifyLogArg(value)),
  };
  workerSelf.postMessage(response);
}

{
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const originalDebug = console.debug.bind(console);

  console.log = (...args: unknown[]) => {
    if (ENABLE_WORKER_CONSOLE_OUTPUT && shouldCaptureLog("log", WORKER_LOG_LEVEL)) {
      originalLog(...args);
    }
    postWorkerLog("log", args);
  };
  console.info = (...args: unknown[]) => {
    if (ENABLE_WORKER_CONSOLE_OUTPUT && shouldCaptureLog("info", WORKER_LOG_LEVEL)) {
      originalInfo(...args);
    }
    postWorkerLog("info", args);
  };
  console.warn = (...args: unknown[]) => {
    if (ENABLE_WORKER_CONSOLE_OUTPUT && shouldCaptureLog("warn", WORKER_LOG_LEVEL)) {
      originalWarn(...args);
    }
    postWorkerLog("warn", args);
  };
  console.error = (...args: unknown[]) => {
    if (ENABLE_WORKER_CONSOLE_OUTPUT && shouldCaptureLog("error", WORKER_LOG_LEVEL)) {
      originalError(...args);
    }
    postWorkerLog("error", args);
  };
  console.debug = (...args: unknown[]) => {
    if (ENABLE_WORKER_CONSOLE_OUTPUT && shouldCaptureLog("debug", WORKER_LOG_LEVEL)) {
      originalDebug(...args);
    }
    postWorkerLog("debug", args);
  };
}

function postProgress(
  id: string,
  stage: WorkerProgressStage,
  message: string,
): void {
  const response: WorkerResponse = {
    id,
    status: "progress",
    stage,
    message,
  };
  workerSelf.postMessage(response);
}

workerSelf.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type !== "convert") {
    return;
  }

  try {
    activeRequestId = request.id;
    postProgress(request.id, "init", "Initializing Wasm runtime...");
    postProgress(request.id, "pyodide-loading", "Loading Pyodide packages...");
    await ensurePyRuntime();

    postProgress(request.id, "py-src-sync", "Python runtime is ready.");
    const pyodideVersion = await getPyodideVersion();
    const runtime = await getPyodide();
    const inputSuffix = request.fileName.toLowerCase().endsWith(".glb")
      ? ".glb"
      : ".vrm";

    runtime.globals.set("__input_bytes", new Uint8Array(request.fileBuffer));
    runtime.globals.set("__input_suffix", inputSuffix);
    runtime.globals.set("__logging_level", PY_LOGGING_LEVEL);

    postProgress(request.id, "converting", "Converting VRM to PMX...");
    await runtime.runPythonAsync(`
  from service.Vrm2PmxBytesService import convert_vrm_zip_bytes
  __output_bytes = convert_vrm_zip_bytes(
      bytes(__input_bytes),
      file_suffix=__input_suffix,
      version_name="wasm-poc",
      logging_level=int(__logging_level),
  )
`);

    const outputBytesProxy = runtime.globals.get("__output_bytes");
    const outputArray =
      outputBytesProxy instanceof Uint8Array
        ? outputBytesProxy
        : (outputBytesProxy.toJs() as Uint8Array);
    const outputBuffer = outputArray.slice().buffer;

    postProgress(request.id, "finalizing", "Finalizing ZIP package...");

    const response: WorkerSuccessResponse = {
      id: request.id,
      status: "ok",
      usedMode: "wasm",
      fileExtension: "zip",
      outputBuffer,
    };

    workerSelf.postMessage(response, [outputBuffer]);

    runtime.globals.delete("__input_bytes");
    runtime.globals.delete("__input_suffix");
    runtime.globals.delete("__logging_level");
    runtime.globals.delete("__output_bytes");

    console.info(
      JSON.stringify({
        event: "wasm.convert.completed",
        pyodideVersion,
        inputBytes: request.fileBuffer.byteLength,
        outputBytes: outputArray.byteLength,
      }),
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? (error.stack ?? error.message)
        : "Unknown wasm worker error";

    console.error(detail);

    const response: WorkerResponse = {
      id: request.id,
      status: "error",
      code: "WASM_CONVERT_FAILED",
      message: detail,
    };
    workerSelf.postMessage(response);
  } finally {
    activeRequestId = null;
  }
};
