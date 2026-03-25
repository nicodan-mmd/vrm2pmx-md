import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const pagesBase = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : "/";

export default defineConfig({
  base: pagesBase,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
        type: "module",
      },
      includeAssets: [
        "assets/favicon/app-icon.svg",
        "assets/favicon/pwa-192.png",
        "assets/favicon/pwa-512.png",
        "assets/favicon/favicon-32.png",
        "assets/favicon/apple-touch-icon.png",
      ],
      manifest: {
        name: "VRM to PMX Converter",
        short_name: "VRM2PMX",
        description:
          "Convert VRM to PMX in your browser with preview. ブラウザ上でVRMをPMXへ変換し、プレビューできるツールです。",
        theme_color: "#8d643d",
        background_color: "#8d643d",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          {
            src: "assets/favicon/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "assets/favicon/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "assets/favicon/favicon-32.png",
            sizes: "32x32",
            type: "image/png",
          },
          {
            src: "assets/favicon/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  worker: {
    format: "es",
  },
});
