import { FormEvent, useMemo, useState } from "react";

type Status = "idle" | "uploading" | "done" | "error";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("VRM file is not selected yet.");

  const disabled = useMemo(
    () => !file || status === "uploading",
    [file, status],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append("vrm_file", file);

    setStatus("uploading");
    setMessage("Converting... this can take a while for large files.");

    try {
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

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const contentDisposition =
        response.headers.get("content-disposition") ?? "";
      const filenameMatch = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(
        contentDisposition,
      );
      const headerFilename = filenameMatch
        ? decodeURIComponent(filenameMatch[1].replace(/"/g, ""))
        : null;
      const baseName = file.name.replace(/\.[^.]+$/, "") || "converted";
      link.href = url;
      link.download = headerFilename ?? `${baseName}.zip`;
      link.click();
      URL.revokeObjectURL(url);

      setStatus("done");
      setMessage("Done. ZIP file downloaded.");
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
          Upload a VRM file and convert it with the local FastAPI backend.
        </p>

        <form className="form" onSubmit={onSubmit}>
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
