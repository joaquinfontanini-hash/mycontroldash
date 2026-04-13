import { execSync } from "child_process";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Fix 1: DB schema push at startup ─────────────────────────────────────────
// Runs drizzle-kit push --force before the server accepts connections.
// Idempotent: safe on every start (no-op if schema is already in sync).
// This ensures production works correctly even when the start script is
// bypassed (e.g. artifact.toml running the binary directly).
try {
  logger.info("DB schema push: starting...");
  execSync("pnpm --filter @workspace/db run push-force", {
    stdio: "pipe",
    cwd: process.cwd(),
    timeout: 60_000,
  });
  logger.info("DB schema push: completed successfully");
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ message }, "DB schema push failed — continuing startup (schema may be out of sync)");
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received — closing server");
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during server close");
      process.exit(1);
    }
    logger.info("Server closed cleanly");
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn("Forced shutdown after timeout");
    process.exit(1);
  }, 8000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
