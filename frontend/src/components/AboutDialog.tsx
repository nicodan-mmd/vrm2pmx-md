import { useEffect } from "react";
import { FaGithub } from "react-icons/fa";

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

          <hr className="about-divider" />

          <p>
            <a
              href="https://github.com/nicodan-mmd/vrm2pmx-md"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              <FaGithub className="about-link-icon" />
              vrm2pmx-md
            </a>
          </p>

          <hr className="about-divider" />

          <p><strong>Special thanks:</strong></p>
          <p>
            <a
              href="https://github.com/miu200521358"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              miu200521358
            </a>
          </p>
          <p>
            Forked from{" "}
            <a
              href="https://github.com/miu200521358/vrm2pmx"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              vrm2pmx
            </a>
          </p>

          <hr className="about-divider" />

          <p><strong>Libraries:</strong>{" "}
            <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer" className="about-link">three.js</a>{" · "}
            <a href="https://github.com/pmndrs/three-stdlib" target="_blank" rel="noopener noreferrer" className="about-link">three-stdlib</a>{" · "}
            <a href="https://github.com/pixiv/three-vrm" target="_blank" rel="noopener noreferrer" className="about-link">@pixiv/three-vrm</a>{" · "}
            <a href="https://pyodide.org/" target="_blank" rel="noopener noreferrer" className="about-link">Pyodide</a>{" · "}
            <a href="https://react.dev/" target="_blank" rel="noopener noreferrer" className="about-link">React</a>{" · "}
            <a href="https://gildas-lormeau.github.io/zip.js/" target="_blank" rel="noopener noreferrer" className="about-link">zip.js</a>{" · "}
            <a href="https://react-icons.github.io/react-icons/" target="_blank" rel="noopener noreferrer" className="about-link">react-icons</a>
          </p>

          <hr className="about-divider" />
          <p>Powered by GitHub Copilot</p>

        </div>
      </section>
    </div>
  );
}
