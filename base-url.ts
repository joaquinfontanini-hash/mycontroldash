/**
 * base-url.ts — Resolución de la URL base de la API
 *
 * Prioridad:
 *   1. VITE_API_URL (env var) → frontend en Vercel, backend en Railway
 *      Ejemplo: VITE_API_URL=https://myapp.up.railway.app
 *   2. BASE_URL de Vite → despliegue en mismo dominio
 *
 * En Vercel, configurar VITE_API_URL en las variables de entorno del proyecto.
 * En Railway (monolito), no configurar VITE_API_URL — se usará BASE_URL="./".
 */

const viteApiUrl = import.meta.env["VITE_API_URL"] as string | undefined;
const rawBase    = import.meta.env["BASE_URL"] ?? "";

export const BASE: string = viteApiUrl
  ? viteApiUrl.replace(/\/+$/, "")
  : rawBase === "./" || rawBase === "."
    ? ""
    : rawBase.replace(/\/$/, "");
