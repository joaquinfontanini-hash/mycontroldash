import { defineConfig } from "vite";
import react        from "@vitejs/plugin-react";
import tailwindcss  from "@tailwindcss/vite";
import path         from "path";

// @replit/vite-plugin-runtime-error-modal solo disponible en Replit — opcional
let runtimeErrorOverlay: (() => import("vite").Plugin) | null = null;
try {
  const mod = await import("@replit/vite-plugin-runtime-error-modal");
  runtimeErrorOverlay = mod.default ?? mod.runtimeErrorOverlay ?? null;
} catch { /* no disponible fuera de Replit — ignorar */ }

export default defineConfig(async ({ command }) => {
  const isBuild = command === "build";

  // ── Base path ───────────────────────────────────────────────────────────────
  // En build para Vercel: BASE_PATH no estará configurado → usar "./"
  // Paths relativos producen "./assets/..." en index.html, funciona en cualquier
  // sub-directorio o CDN. Un BASE_PATH="/" solo funciona desde la raíz del dominio.
  const rawBase = process.env["BASE_PATH"];
  let basePath: string;
  if (isBuild) {
    basePath = rawBase && rawBase !== "/" ? rawBase : "./";
  } else {
    // Dev: BASE_PATH es requerido para el servidor de Vite
    if (!rawBase) {
      throw new Error("BASE_PATH es requerido para el servidor de desarrollo (dev).");
    }
    basePath = rawBase;
  }

  // ── Puerto del servidor de desarrollo ──────────────────────────────────────
  // PORT no se requiere en build (Vercel no lo inyecta durante el build).
  // Solo se valida para los comandos dev/preview.
  const rawPort = process.env["PORT"];
  let port = 5173; // default de Vite
  if (!isBuild) {
    const parsed = rawPort ? Number(rawPort) : NaN;
    if (rawPort && (!Number.isFinite(parsed) || parsed <= 0)) {
      throw new Error(`PORT inválido: "${rawPort}". Debe ser un número positivo.`);
    }
    port = Number.isFinite(parsed) && parsed > 0 ? parsed : 5173;
  }

  // ── Plugins de Replit (solo en dev, solo si REPL_ID está presente) ─────────
  // En Vercel/Railway REPL_ID no existe — los imports fallarían en build.
  // El guard `!isBuild` garantiza que nunca se ejecuten en producción.
  const devPlugins: import("vite").Plugin[] = [];
  if (!isBuild && process.env["REPL_ID"] !== undefined) {
    try {
      const [cartographerMod, bannerMod] = await Promise.all([
        import("@replit/vite-plugin-cartographer"),
        import("@replit/vite-plugin-dev-banner"),
      ]);
      devPlugins.push(
        cartographerMod.cartographer({ root: path.resolve(import.meta.dirname, "..") }),
        bannerMod.devBanner(),
      );
    } catch { /* plugins no disponibles — ignorar */ }
  }

  return {
    base: basePath,

    plugins: [
      react(),
      tailwindcss(),
      ...(runtimeErrorOverlay && !isBuild ? [runtimeErrorOverlay()] : []),
      ...devPlugins,
    ],

    resolve: {
      alias: {
        "@":       path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      // Evitar instancias duplicadas de React en el bundle — crítico con monorepos
      dedupe: ["react", "react-dom", "@tanstack/react-query"],
    },

    root: path.resolve(import.meta.dirname),

    build: {
      // ── outDir alineado con vercel.json → outputDirectory: "artifacts/dashboard/dist"
      // El original producía "dist/public" (un nivel más profundo).
      // Vercel espera encontrar index.html en el outputDirectory — no en un subdirectorio.
      outDir:     path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,

      // Optimizaciones de bundle para producción
      rollupOptions: {
        output: {
          // Code splitting manual: separar vendor libs grandes de la app code
          manualChunks(id) {
            // React y react-dom en su propio chunk — cambian raramente → mejor cache
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
              return "react-vendor";
            }
            // Clerk en chunk propio — es grande y solo necesario en Clerk mode
            if (id.includes("@clerk")) {
              return "clerk-vendor";
            }
            // Tanstack query en chunk propio
            if (id.includes("@tanstack")) {
              return "query-vendor";
            }
            // Radix UI components — cambian poco → cache
            if (id.includes("@radix-ui")) {
              return "radix-vendor";
            }
          },
        },
      },
    },

    server: {
      port,
      host:         "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny:   ["**/.env", "**/.env.*", "**/.*"],
      },
    },

    preview: {
      port,
      host:         "0.0.0.0",
      allowedHosts: true,
    },
  };
});
