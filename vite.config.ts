import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "meterflo-browser-error-diagnostics",
      apply: "serve",
      transformIndexHtml: {
        order: "pre",
        async handler() {
          // Classic script runs before the overlay's module registers listeners.
          // Load/compile only in development, never during standalone startup.
          const { readFile } = await import("node:fs/promises");
          const { transform } = await import("esbuild");
          const source = await readFile(path.resolve(import.meta.dirname, "client/src/lib/browser-runtime-errors.ts"), "utf8");
          const { code } = await transform(`${source}\ninstallBrowserRuntimeErrors(window);`, { loader: "ts", format: "iife", target: "es2020" });
          return [{ tag: "script", children: code, injectTo: "head-prepend" }];
        },
      },
    },
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
