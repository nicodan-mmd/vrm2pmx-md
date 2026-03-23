import { loadPyodide, type PyodideInterface } from "pyodide";

const PYODIDE_VERSION = "0.29.3";

let pyodidePromise: Promise<PyodideInterface> | null = null;

export async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({
      // Keep explicit version path aligned with the installed pyodide package.
      indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`,
    });
  }
  return pyodidePromise;
}

export async function getPyodideVersion(): Promise<string> {
  const pyodide = await getPyodide();
  const version = pyodide.runPython("import sys; sys.version") as string;
  return version.split(" ")[0];
}
