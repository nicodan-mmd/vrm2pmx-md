import { useEffect } from "react";

type AboutDialogProps = {
  open: boolean;
  version: string;
  onClose: () => void;
};

export default function AboutDialog({ open, version, onClose }: AboutDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="about-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="about-modal-header">
          <h2 id="about-title">About</h2>
          <button type="button" className="about-close-button" onClick={onClose} aria-label="Close about dialog">
            Close
          </button>
        </header>
        <div className="about-modal-body">
          <p><strong>VRM to PMX Converter</strong></p>
          <p>Version {version}</p>
          <p>This tool converts VRM models to PMX format in browser using Wasm/Pyodide runtime.</p>
          <p>Use this panel for version confirmation and basic project information.</p>
        </div>
      </section>
    </div>
  );
}
