// API base URL resolution:
// 1. VITE_API_URL env var → usado cuando frontend y backend están en dominios distintos
//    (ej: frontend en Vercel, backend en Railway)
// 2. BASE_URL de Vite → para despliegues en el mismo dominio (Replit, self-hosted)
const viteApiUrl = import.meta.env.VITE_API_URL as string | undefined;
const rawBase = import.meta.env.BASE_URL ?? "";
export const BASE = viteApiUrl
  ? viteApiUrl.replace(/\/+$/, "")
  : (rawBase === "./" || rawBase === ".") ? "" : rawBase.replace(/\/$/, "");
