import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");
const srcRoot = path.join(repoRoot, "src");
const publicRoot = path.join(repoRoot, "frontend", "public");
const targetRoot = path.join(publicRoot, "py_src");
const manifestPath = path.join(publicRoot, "py_src_manifest.json");

const targetDirs = ["config", "mmd", "module", "service", "utils"];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function removeDirIfExists(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

async function listPyFiles(baseDir) {
  const result = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".py")) {
        result.push(fullPath);
      }
    }
  }

  await walk(baseDir);
  return result;
}

async function copyTree() {
  await ensureDir(publicRoot);
  await removeDirIfExists(targetRoot);
  await ensureDir(targetRoot);

  const manifest = [];

  for (const dirName of targetDirs) {
    const sourceDir = path.join(srcRoot, dirName);
    const pyFiles = await listPyFiles(sourceDir);

    for (const filePath of pyFiles) {
      const relativeFromSrc = path.relative(srcRoot, filePath).replaceAll("\\", "/");
      const destinationPath = path.join(targetRoot, relativeFromSrc);

      await ensureDir(path.dirname(destinationPath));
      await fs.copyFile(filePath, destinationPath);
      manifest.push(relativeFromSrc);
    }
  }

  manifest.sort();
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  console.log(`Synced ${manifest.length} python files to frontend/public/py_src`);
}

copyTree().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
