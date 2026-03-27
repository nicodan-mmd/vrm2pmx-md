import { loadPyodide, type PyodideInterface } from "pyodide";
import { getRuntimeLogLevel, shouldCaptureLog } from "../utils/logging";

const PYODIDE_VERSION = "0.29.3";
const PYODIDE_LOG_LEVEL = getRuntimeLogLevel();

let pyodidePromise: Promise<PyodideInterface> | null = null;

export async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({
      // Keep explicit version path aligned with the installed pyodide package.
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
      stdout: (message: string) => {
        if (shouldCaptureLog("info", PYODIDE_LOG_LEVEL)) {
          console.info(`[pyodide] ${message}`);
        }
      },
      stderr: (message: string) => {
        if (shouldCaptureLog("error", PYODIDE_LOG_LEVEL)) {
          console.error(`[pyodide] ${message}`);
        }
      },
    });
  }
  return pyodidePromise;
}

export async function getPyodideVersion(): Promise<string> {
  const pyodide = await getPyodide();
  const version = pyodide.runPython("import sys; sys.version") as string;
  return version.split(" ")[0];
}
