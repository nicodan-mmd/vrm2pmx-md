import { loadPyodide, type PyodideInterface } from "pyodide";

let pyodidePromise: Promise<PyodideInterface> | null = null;

export async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = loadPyodide({
      // Keep explicit version path to avoid accidental major upgrades.
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/",
    });
  }
  return pyodidePromise;
}

export async function getPyodideVersion(): Promise<string> {
  const pyodide = await getPyodide();
  const version = pyodide.runPython("import sys; sys.version") as string;
  return version.split(" ")[0];
}
