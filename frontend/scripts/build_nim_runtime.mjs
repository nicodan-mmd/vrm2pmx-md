import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import wabtInit from "wabt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendRoot = path.resolve(__dirname, "..");
const outputDir = path.join(frontendRoot, "public", "nim");
const sourceWatPath = path.join(outputDir, "vrm2pmx_nim_runtime.wat");
const targetWasmPath = path.join(outputDir, "vrm2pmx_nim_runtime.wasm");
const manifestPath = path.join(outputDir, "vrm2pmx_nim_manifest.json");

async function main() {
  const wabt = await wabtInit();
  const watSource = await fs.readFile(sourceWatPath, "utf8");
  const module = wabt.parseWat(sourceWatPath, watSource);

  module.resolveNames();
  module.validate();

  const { buffer } = module.toBinary({
    log: false,
    write_debug_names: true,
  });

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(targetWasmPath, Buffer.from(buffer));

  const manifest = {
    name: "vrm2pmx-nim-runtime",
    version: "0.1.0",
    status: "wasm-pmx-output",
    entryJs: "nim/vrm2pmx_nim_loader.js",
    entryWasm: "nim/vrm2pmx_nim_runtime.wasm",
    capabilities: [
      "loader-bridge",
      "wasi-preview1-stubbed",
      "nim-wasm-init",
      "nim-wasm-alloc",
      "nim-wasm-free",
      "nim-wasm-convert",
      "pmx-output",
    ],
    notes: [
      "Generated from frontend/public/nim/vrm2pmx_nim_runtime.wat via wabt.",
      "Browser worker calls Nim C ABI exports directly and receives PMX bytes.",
      "This runtime is fully client-side and does not require the local Nim exe.",
    ],
  };

  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  module.destroy();

  const stat = await fs.stat(targetWasmPath);
  console.log(`Built Nim runtime wasm: ${targetWasmPath} (${stat.size} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
