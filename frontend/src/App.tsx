import { FormEvent, useMemo, useState } from "react";
import {
  type ConvertMode,
  convertWithMode,
} from "./services/convertClient";

type Status = "idle" | "uploading" | "done" | "error";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<ConvertMode>("auto");
  const [message, setMessage] = useState("VRM file is not selected yet.");

  const disabled = useMemo(
    () => !file || status === "uploading",
    [file, status],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;

    setStatus("uploading");
    setMessage(
      mode === "backend"
        ? "Converting with backend... this can take a while for large files."
        : "Trying Wasm first. If it fails, backend fallback will run.",
    );

    try {
      const result = await convertWithMode(file, mode);
      const blob = result.blob;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = file.name.replace(/\.[^.]+$/, "") || "converted";
      const extension = result.fileExtension;
      const usedMode = result.usedMode;
      link.href = url;
      link.download = `${baseName}.${extension}`;
      link.click();
      URL.revokeObjectURL(url);

      setStatus("done");
      if (result.fallbackReason) {
        setMessage(
          `Done with fallback. Requested: ${mode}, used: ${usedMode}. Reason: ${result.fallbackReason}`,
        );
      } else {
        setMessage(`Done. Converted file downloaded via ${usedMode}.`);
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  return (
    <main className="page">
      <div className="halo" />
      <section className="card">
        <p className="eyebrow">vrm2pmx web poc</p>
        <h1>VRM to PMX Converter</h1>
        <p className="lead">
          Upload a VRM file and convert with Auto, Backend, or Wasm mode.
        </p>

        <form className="form" onSubmit={onSubmit}>
          <label htmlFor="mode" className="input-label">
            Convert mode
          </label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as ConvertMode)}
            disabled={status === "uploading"}
          >
            <option value="auto">Auto (Wasm first, then Backend fallback)</option>
            <option value="backend">Backend (FastAPI)</option>
            <option value="wasm">Wasm (Pyodide runtime init)</option>
          </select>

          <label htmlFor="vrm-input" className="input-label">
            Choose VRM file
          </label>
          <input
            id="vrm-input"
            type="file"
            accept=".vrm,.glb"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />

          <button type="submit" disabled={disabled}>
            {status === "uploading"
              ? "Converting..."
              : "Convert and Download PMX"}
          </button>
        </form>

        <p className={`status status-${status}`}>{message}</p>
      </section>
    </main>
  );
}
