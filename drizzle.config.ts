import { defineConfig } from "drizzle-kit";

// ── Validación temprana de DATABASE_URL ───────────────────────────────────────
// Falla en startup con mensaje claro en lugar de un error críptico de Postgres
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "[drizzle.config] DATABASE_URL no está definida.\n" +
      "  • Desarrollo local: copiá .env.example a .env y completá los valores.\n" +
      "  • Railway: configurá la variable en el panel de Environment Variables.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  migrations: {
    // Tabla de control de migraciones — no confundir con tablas de aplicación
    table: "__drizzle_migrations",
    schema: "public",
  },
  // Excluir tablas que no administra Drizzle:
  //   - session: tabla de express-session (si se usa pg-session-store)
  //   - __drizzle_migrations: la propia tabla de control de Drizzle
  //   - tablas de Supabase/extensiones internas
  tablesFilter: [
    "!session",
    "!__drizzle_migrations",
    "!pg_*",
    "!information_schema",
  ],
  // Deshabilitar push destructivo en producción
  // Para producción usar siempre: pnpm db:generate + pnpm db:migrate
  verbose: process.env.NODE_ENV !== "production",
  strict: process.env.NODE_ENV === "production",
});
