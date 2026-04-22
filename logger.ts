import pino from "pino";

const isProduction = process.env["NODE_ENV"] === "production";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",

  // ── Campos a redactar en todos los logs ────────────────────────────────────
  // Estos campos se reemplazan por "[Redacted]" antes de escribir el log.
  // Previenen filtrado accidental de credenciales a Railway logs o
  // cualquier servicio de logging externo.
  redact: {
    paths: [
      // HTTP — tokens de sesión y autenticación
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      // Variables de entorno sensibles — si alguien loguea process.env accidentalmente
      "DATABASE_URL",
      "SESSION_SECRET",
      "EMAIL_ENCRYPTION_KEY",
      "CLERK_SECRET_KEY",
      "SMTP_PASS",
      // Campos de usuario — nunca loguear hashes de contraseñas
      "*.passwordHash",
      "*.password_hash",
      "*.accessToken",
      "*.refreshToken",
      "*.access_token",
      "*.refresh_token",
    ],
    censor: "[Redacted]",
  },

  // ── Formato según entorno ──────────────────────────────────────────────────
  // Producción (Railway): JSON estructurado, sin colores — compatible con
  //   cualquier agregador de logs (Datadog, BetterStack, Railway built-in)
  // Desarrollo: pino-pretty con colores para lectura humana en terminal
  ...(isProduction
    ? {
        // Timestamp en ISO 8601 para mejor correlación en Railway
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target:  "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" },
        },
      }),
});
