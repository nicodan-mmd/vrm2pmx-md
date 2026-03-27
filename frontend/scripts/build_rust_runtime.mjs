import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendRoot = path.resolve(__dirname, "..");
const crateRoot = path.join(frontendRoot, "rust-runtime");
const outputDir = path.join(frontendRoot, "public", "rust");
const sourceWasmPath = path.join(
  crateRoot,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "vrm2pmx_rust_runtime.wasm",
);
const targetWasmPath = path.join(outputDir, "vrm2pmx_rust_stub.wasm");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  await run(
    "cargo",
    ["build", "--release", "--target", "wasm32-unknown-unknown"],
    crateRoot,
  );

  await fs.mkdir(outputDir, { recursive: true });
  await fs.copyFile(sourceWasmPath, targetWasmPath);
  const stat = await fs.stat(targetWasmPath);
  console.log(`Built Rust runtime wasm: ${targetWasmPath} (${stat.size} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});