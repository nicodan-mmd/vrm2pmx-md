import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : "/";

export default defineConfig({
  base: pagesBase,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  worker: {
    format: "es",
  },
});
