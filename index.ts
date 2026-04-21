import app from "./app.js";
import { logger } from "./lib/logger.js";
import { verifyDatabaseConnection, closeDatabasePool } from "@workspace/db";
import { reclassifyAllNews } from "./services/news.service.js";
import { seedTravelLocationsIfNeeded } from "./services/travelSeedService.js";

// ── Puerto ────────────────────────────────────────────────────────────────────
// Railway inyecta PORT dinámicamente en cada deploy.
// No lanzar excepción si PORT no está definida — usar fallback 3000 para dev.
// El valor de PORT en producción siempre viene de Railway, nunca lo hardcodeamos.
const rawPort = process.env["PORT"];
const port = rawPort ? Number(rawPort) : 3000;

if (Number.isNaN(port) || port <= 0 || port > 65535) {
  logger.error({ rawPort }, "Valor de PORT inválido — abortando");
  process.exit(1);
}

// ── Verificación de conexión a la DB antes de aceptar tráfico ─────────────────
// Falla rápido si la DB no está disponible, con reintentos y mensaje claro.
// Esto reemplaza el execSync("drizzle-kit push") del original, que:
//   1. Bloqueaba el event loop durante el startup
//   2. Podía causar timeout del healthcheck de Railway
//   3. Se ejecutaba dos veces (también en el script start del package.json)
// El schema se aplica UNA sola vez en deploy, desde el script start del package.json.
// Esta verificación solo confirma conectividad — no modifica la DB.
try {
  await verifyDatabaseConnection(3, 2000);
} catch (err) {
  logger.error({ err }, "No se pudo conectar a la DB — abortando servidor");
  process.exit(1);
}

// ── Advertencias de configuración ────────────────────────────────────────────
if (!process.env["APP_URL"]) {
  logger.warn(
    "APP_URL no está definida — los links en emails de recuperación de contraseña " +
      "apuntarán a localhost. Configurá APP_URL en Railway con la URL de Vercel.",
  );
}

if (!process.env["EMAIL_ENCRYPTION_KEY"]) {
  logger.warn(
    "EMAIL_ENCRYPTION_KEY no está definida — se usa SESSION_SECRET como fallback " +
      "para encriptar credenciales SMTP. Configurá una clave dedicada.",
  );
}

if (!process.env["SERPAPI_KEY"]) {
  logger.warn(
    "SERPAPI_KEY no está definida — el módulo de noticias no podrá buscar artículos externos.",
  );
}

// ── Levantar servidor ─────────────────────────────────────────────────────────
const server = app.listen(port, () => {
  logger.info(
    { port, env: process.env["NODE_ENV"] ?? "development" },
    "Servidor escuchando ✓",
  );

  // Tareas de fondo — no bloquean el startup ni el healthcheck
  // Se ejecutan con setImmediate para no retrasar la primera respuesta
  setImmediate(() => {
    // Reclasifica artículos existentes que aún no tienen classification_reason.
    // Solo toca artículos con campo vacío — los ya clasificados se omiten.
    reclassifyAllNews(false).catch((err: unknown) => {
      logger.error({ err }, "Reclasificación de noticias fallida (no crítico)");
    });

    // Populate del catálogo de ubicaciones de viajes si está desactualizado.
    seedTravelLocationsIfNeeded().catch((err: unknown) => {
      logger.error({ err }, "Seed de travel locations fallido (no crítico)");
    });
  });
});

// ── Manejo de error en listen ──────────────────────────────────────────────────
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error({ port }, `Puerto ${port} ya está en uso`);
  } else {
    logger.error({ err }, "Error al levantar el servidor");
  }
  process.exit(1);
});

// ── Shutdown graceful ─────────────────────────────────────────────────────────
// Railway envía SIGTERM antes de detener el contenedor.
// El timeout de 10s da tiempo a que terminen los requests en vuelo.
// closeDatabasePool() cierra el pool de pg correctamente sin dejar conexiones colgadas.
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Señal de shutdown recibida — cerrando servidor");

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, "Error al cerrar el servidor HTTP");
    } else {
      logger.info("Servidor HTTP cerrado");
    }

    try {
      await closeDatabasePool();
    } catch (dbErr) {
      logger.error({ err: dbErr }, "Error al cerrar el pool de DB");
    }

    process.exit(err ? 1 : 0);
  });

  // Forzar salida después de 10s si los requests no terminaron
  setTimeout(() => {
    logger.warn("Shutdown forzado por timeout (10s)");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

// ── Manejo de rechazos no capturados ──────────────────────────────────────────
// Previene que un Promise rejection sin .catch() tire abajo el servidor
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection — revisar el stack trace");
  // No se termina el proceso — solo se loguea. Railway lo reiniciará si
  // el healthcheck empieza a fallar.
});

process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException — terminando proceso");
  process.exit(1);
});
