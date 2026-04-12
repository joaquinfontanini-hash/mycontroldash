import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async ({ command }) => {
  const isBuild = command === "build";

  // PORT is only required for the dev/preview server, never for build
  const rawPort = process.env.PORT;
  const port = rawPort ? Number(rawPort) : 0;
  if (!isBuild && (!rawPort || Number.isNaN(port) || port <= 0)) {
    throw new Error("PORT environment variable is required for dev server.");
  }

  // During build: default to "./" for portable relative-path assets.
  // Absolute base paths (e.g. "/") produce "/assets/..." in index.html which
  // only works when the app is served from the domain root.
  // "./" produces "./assets/..." which works anywhere.
  const rawBase = process.env.BASE_PATH;
  let basePath: string;
  if (isBuild) {
    basePath = rawBase && rawBase !== "/" ? rawBase : "./";
  } else {
    if (!rawBase) {
      throw new Error("BASE_PATH environment variable is required for dev server.");
    }
    basePath = rawBase;
  }

  const devPlugins =
    !isBuild && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : [];

  return {
    base: basePath,
    plugins: [react(), tailwindcss(), runtimeErrorOverlay(), ...devPlugins],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
