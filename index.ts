import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema/index.js";

// ── Validación de DATABASE_URL ─────────────────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "[db/index] DATABASE_URL no está definida.\n" +
      "  • Desarrollo local: copiá .env.example a .env y completá los valores.\n" +
      "  • Railway: configurá la variable en el panel de Environment Variables.",
  );
}

// ── Configuración del pool ─────────────────────────────────────────────────────
// Railway usa conexión directa (puerto 5432) — no el pooler de Supabase (6543).
// Para Supabase directa, SSL es requerido. El certificado raíz de Supabase
// se acepta sin verificación de CA para simplificar el deploy.
const poolConfig: PoolConfig = {
  connectionString: databaseUrl,
  // Supabase requiere SSL en conexiones directas
  ssl: databaseUrl.includes("supabase")
    ? { rejectUnauthorized: false }
    : undefined,
  // Pool sizing para Railway: un servidor pequeño no debería saturar Supabase
  max: parseInt(process.env.DB_POOL_MAX ?? "10", 10),
  min: parseInt(process.env.DB_POOL_MIN ?? "2", 10),
  // Timeout de conexión (ms) — falla rápido si la DB no está disponible
  connectionTimeoutMillis: parseInt(
    process.env.DB_CONNECTION_TIMEOUT_MS ?? "5000",
    10,
  ),
  // Timeout de query idle antes de liberar la conexión al pool
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS ?? "30000", 10),
};

// ── Crear pool ─────────────────────────────────────────────────────────────────
export const pool = new Pool(poolConfig);

// ── Manejo de errores en conexiones idle ──────────────────────────────────────
// Sin este handler, un error en una conexión idle mata el proceso con unhandled rejection
pool.on("error", (err) => {
  console.error("[db/pool] Error en conexión idle del pool:", err.message);
  // No relanzamos — el pool intentará reconectarse automáticamente
});

// ── Instancia de Drizzle ───────────────────────────────────────────────────────
export const db = drizzle(pool, {
  schema,
  logger: process.env.NODE_ENV === "development" && process.env.DB_LOG === "true",
});

// ── Verificación de conectividad al iniciar ───────────────────────────────────
// Esta función se llama desde el entry point del servidor (index.ts)
// para fallar rápido en startup si la DB no está disponible.
export async function verifyDatabaseConnection(
  retries = 3,
  delayMs = 2000,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("[db] Conexión a la base de datos verificada ✓");
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        console.warn(
          `[db] Intento ${attempt}/${retries} fallido: ${message}. Reintentando en ${delayMs}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        throw new Error(
          `[db] No se pudo conectar a la base de datos después de ${retries} intentos.\n` +
            `  Último error: ${message}\n` +
            `  Verificá que DATABASE_URL sea correcta y que Supabase esté disponible.`,
        );
      }
    }
  }
}

// ── Cierre graceful del pool ──────────────────────────────────────────────────
// Llamar desde el handler de SIGTERM/SIGINT en index.ts del servidor
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
  console.log("[db] Pool de conexiones cerrado.");
}

// Re-exportar schema y tipos útiles
export * from "./schema/index.js";
export type { InferInsertModel, InferSelectModel } from "drizzle-orm";
